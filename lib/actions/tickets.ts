"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { limit } from "@/lib/ratelimit";
import {
  createTicketSchema,
  replyTicketSchema,
  computeSlaDates,
  formatTicketNumber,
} from "@/lib/tickets/rules";
import { canTicketTransition } from "@/lib/tickets/transitions";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { revalidatePath } from "next/cache";
import { getSettings } from "@/lib/settings";
import type { TicketCategory } from "@prisma/client";

export interface CreateCustomerTicketInput {
  subject: string;
  body: string;
  category: TicketCategory;
  orderId?: string | null;
  orderRef?: string | null;
}

/**
 * Creates a support ticket from an authenticated customer account.
 * Validates ownership if an orderId is provided.
 * Enqueues customer acknowledgement and support team alert emails.
 */
export async function createTicket(input: CreateCustomerTicketInput) {
  const user = await requireUser();

  const rateCheck = await limit("ticketCreateUser", user.id);
  if (!rateCheck.ok) {
    throw new Error("Too many tickets created. Please wait before opening another ticket.");
  }

  const parsed = createTicketSchema.parse(input);

  // If orderId is supplied, verify it belongs to the authenticated user
  let verifiedOrderId: string | null = null;
  if (parsed.orderId) {
    const order = await prisma.order.findFirst({
      where: {
        id: parsed.orderId,
        userId: user.id,
      },
      select: { id: true, displayId: true },
    });

    if (!order) {
      throw new Error("Order not found or does not belong to your account.");
    }
    verifiedOrderId = order.id;
  }

  const settings = await getSettings();
  const supportEmail = settings.supportEmail?.trim() || process.env.SUPPORT_EMAIL?.trim() || null;
  const now = new Date();
  const { ackDueAt, resolveDueAt } = computeSlaDates(now);

  const { ticket, message } = await prisma.$transaction(async (tx) => {
    // Generate next ticket number from PostgreSQL sequence
    const seqRes: Array<{ nextval: bigint | number }> = await tx.$queryRaw`
      SELECT nextval('ticket_number_seq');
    `;
    const nextSeq = Number(seqRes[0].nextval);
    const ticketNumber = formatTicketNumber(nextSeq);

    const newTicket = await tx.ticket.create({
      data: {
        number: ticketNumber,
        userId: user.id,
        orderId: verifiedOrderId,
        orderRef: parsed.orderRef || null,
        category: parsed.category,
        subject: parsed.subject,
        status: "OPEN",
        source: "ACCOUNT",
        ackDueAt,
        resolveDueAt,
        createdAt: now,
      },
    });

    const firstMsg = await tx.ticketMessage.create({
      data: {
        ticketId: newTicket.id,
        authorType: "CUSTOMER",
        authorUserId: user.id,
        body: parsed.body,
        internal: false,
        createdAt: now,
      },
    });

    return { ticket: newTicket, message: firstMsg };
  });

  // Outbox: Customer Acknowledgement Email
  const customerEmail = user.email;
  if (customerEmail) {
    await enqueueOutbox({
      type: "TICKET_ACKNOWLEDGED",
      channel: "EMAIL",
      orderId: verifiedOrderId,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        recipientEmail: customerEmail,
        customerName: user.name || "Customer",
        subject: ticket.subject,
        body: message.body,
      },
      dedupeKey: `ticket_ack_${ticket.id}`,
    });
  }

  // Outbox: Support Team Notification Email
  const alertRecipient =
    ticket.category === "GRIEVANCE" && settings.grievanceOfficerEmail?.trim()
      ? settings.grievanceOfficerEmail.trim()
      : supportEmail;
  if (alertRecipient) {
    await enqueueOutbox({
      type: "TICKET_SUPPORT_ALERT",
      channel: "EMAIL",
      orderId: verifiedOrderId,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        subject: ticket.subject,
        category: ticket.category,
        customerName: user.name || "Customer",
        customerEmail: user.email || "No email",
        body: message.body,
        isGrievance: ticket.category === "GRIEVANCE",
        recipientEmail: alertRecipient,
      },
      dedupeKey: `ticket_support_alert_${ticket.id}`,
    });
  } else {
    console.warn("[Tickets] Skipping TICKET_SUPPORT_ALERT: no supportEmail configured.");
  }

  revalidatePath("/account");
  return {
    success: true,
    ticket: {
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      status: ticket.status,
    },
  };
}

/**
 * Adds a customer reply to an authenticated user's ticket.
 * Reopens RESOLVED tickets if within 14 days; rejects replies on CLOSED tickets.
 */
export async function replyToTicket(ticketId: string, bodyText: string) {
  const user = await requireUser();

  const rateCheck = await limit("ticketReply", user.id);
  if (!rateCheck.ok) {
    throw new Error("Too many replies. Please wait a moment before replying again.");
  }

  const parsed = replyTicketSchema.parse({ body: bodyText });

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      userId: user.id,
    },
  });

  if (!ticket) {
    throw new Error("Ticket not found.");
  }

  if (ticket.status === "CLOSED") {
    throw new Error("Cannot reply to a closed ticket.");
  }

  const now = new Date();
  let nextStatus = ticket.status;

  if (ticket.status === "RESOLVED") {
    const canReopen = canTicketTransition("RESOLVED", "OPEN", {
      isCustomer: true,
      resolvedAt: ticket.resolvedAt,
      now,
    });
    if (!canReopen) {
      throw new Error(
        "This ticket was resolved more than 14 days ago and cannot be reopened. Please open a new ticket."
      );
    }
    nextStatus = "OPEN";
  } else if (ticket.status === "WAITING_CUSTOMER") {
    nextStatus = "IN_PROGRESS";
  }

  const { message } = await prisma.$transaction(async (tx) => {
    const updatedTicket = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
        resolvedAt: nextStatus === "OPEN" ? null : ticket.resolvedAt,
        updatedAt: now,
      },
    });

    const msg = await tx.ticketMessage.create({
      data: {
        ticketId: updatedTicket.id,
        authorType: "CUSTOMER",
        authorUserId: user.id,
        body: parsed.body,
        internal: false,
        createdAt: now,
      },
    });

    return { ticket: updatedTicket, message: msg };
  });

  const settings = await getSettings();
  const supportEmail = settings.supportEmail?.trim() || process.env.SUPPORT_EMAIL?.trim() || null;

  // Notify support of customer reply
  const alertRecipient =
    ticket.category === "GRIEVANCE" && settings.grievanceOfficerEmail?.trim()
      ? settings.grievanceOfficerEmail.trim()
      : supportEmail;
  if (alertRecipient) {
    await enqueueOutbox({
      type: "TICKET_SUPPORT_ALERT",
      channel: "EMAIL",
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        subject: `Reply on ${ticket.number}: ${ticket.subject}`,
        category: ticket.category,
        customerName: user.name || "Customer",
        customerEmail: user.email || "No email",
        body: message.body,
        isGrievance: ticket.category === "GRIEVANCE",
        recipientEmail: alertRecipient,
      },
      dedupeKey: `ticket_reply_alert_${message.id}`,
    });
  } else {
    console.warn("[Tickets] Skipping TICKET_SUPPORT_ALERT reply: no supportEmail configured.");
  }

  revalidatePath("/account");
  return { success: true, messageId: message.id };
}

/**
 * Retrieves the tickets belonging to the authenticated customer.
 * Explicitly excludes internal messages and staff IDs.
 */
export async function getCustomerTickets() {
  const user = await requireUser();

  const tickets = await prisma.ticket.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      status: true,
      orderRef: true,
      ackDueAt: true,
      resolveDueAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      closedAt: true,
      createdAt: true,
      messages: {
        where: { internal: false },
        select: {
          id: true,
          authorType: true,
          body: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return tickets.map((t) => ({
    ...t,
    messages: t.messages.map((m) => ({
      id: m.id,
      author: m.authorType === "CUSTOMER" ? "You" : "Support team",
      body: m.body,
      createdAt: m.createdAt,
    })),
  }));
}
