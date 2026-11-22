"use server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { replyTicketSchema } from "@/lib/tickets/rules";
import { canTicketTransition } from "@/lib/tickets/transitions";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { revalidatePath } from "next/cache";
import type { TicketStatus } from "@prisma/client";

/**
 * Assigns or unassigns a ticket to a staff member.
 * Requires STAFF or OWNER session.
 */
export async function assignTicket(ticketId: string, assignedToId: string | null) {
  const staff = await requireStaff();

  if (assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: assignedToId,
        role: { in: ["STAFF", "OWNER"] },
      },
      select: { id: true, name: true, email: true },
    });

    if (!assignee) {
      throw new Error("Assignee not found or is not a staff member.");
    }
  }

  const updatedTicket = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      assignedToId: assignedToId || null,
      updatedAt: new Date(),
    },
  });

  await writeAudit({
    actorId: staff.id,
    action: "TICKET_ASSIGNED",
    entity: "Ticket",
    entityId: ticketId,
    meta: { assignedToId },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
  return { success: true, ticket: updatedTicket };
}

/**
 * Updates the lifecycle status of a ticket adhering to legal transitions.
 * If set to RESOLVED: sets resolvedAt and enqueues customer notification email once.
 * If set to CLOSED: sets closedAt.
 */
export async function setTicketStatus(ticketId: string, newStatus: TicketStatus) {
  const staff = await requireStaff();

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: true },
  });

  if (!ticket) {
    throw new Error("Ticket not found.");
  }

  const isAllowed = canTicketTransition(ticket.status, newStatus);
  if (!isAllowed) {
    throw new Error(
      `Illegal ticket status transition from ${ticket.status} to ${newStatus}.`
    );
  }

  const now = new Date();
  const dataToUpdate: {
    status: TicketStatus;
    resolvedAt?: Date | null;
    closedAt?: Date | null;
    updatedAt: Date;
  } = {
    status: newStatus,
    updatedAt: now,
  };

  if (newStatus === "RESOLVED") {
    dataToUpdate.resolvedAt = now;
  } else if (newStatus === "CLOSED") {
    dataToUpdate.closedAt = now;
  } else if (newStatus === "OPEN" && ticket.status === "RESOLVED") {
    // Reopen clears resolvedAt
    dataToUpdate.resolvedAt = null;
  }

  const updatedTicket = await prisma.ticket.update({
    where: { id: ticketId },
    data: dataToUpdate,
  });

  // Outbox: Customer notification on resolution
  if (newStatus === "RESOLVED") {
    const customerEmail = ticket.guestEmail || ticket.user?.email;
    if (customerEmail) {
      await enqueueOutbox({
        type: "TICKET_RESOLVED",
        channel: "EMAIL",
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          recipientEmail: customerEmail,
          customerName: ticket.guestName || ticket.user?.name || "Customer",
          subject: ticket.subject,
        },
        dedupeKey: `ticket_resolved_${ticket.id}`,
      });
    }
  }

  await writeAudit({
    actorId: staff.id,
    action: "TICKET_STATUS_UPDATED",
    entity: "Ticket",
    entityId: ticketId,
    meta: { from: ticket.status, to: newStatus },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
  return { success: true, ticket: updatedTicket };
}

/**
 * Adds a public staff reply to the ticket thread.
 * Enqueues customer email notification.
 */
export async function staffReply(ticketId: string, bodyText: string) {
  const staff = await requireStaff();
  const parsed = replyTicketSchema.parse({ body: bodyText });

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: true },
  });

  if (!ticket) {
    throw new Error("Ticket not found.");
  }

  if (ticket.status === "CLOSED") {
    throw new Error("Cannot reply to a closed ticket.");
  }

  const now = new Date();
  const nextStatus = ticket.status === "OPEN" || ticket.status === "IN_PROGRESS"
    ? "WAITING_CUSTOMER"
    : ticket.status;

  const { message } = await prisma.$transaction(async (tx) => {
    const msg = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: "STAFF",
        authorUserId: staff.id,
        body: parsed.body,
        internal: false,
        createdAt: now,
      },
    });

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
        updatedAt: now,
      },
    });

    return { message: msg };
  });

  // Outbox: Public reply notification to customer
  const customerEmail = ticket.guestEmail || ticket.user?.email;
  if (customerEmail) {
    await enqueueOutbox({
      type: "TICKET_STAFF_REPLY",
      channel: "EMAIL",
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        recipientEmail: customerEmail,
        customerName: ticket.guestName || ticket.user?.name || "Customer",
        subject: ticket.subject,
        body: message.body,
      },
      dedupeKey: `ticket_staff_reply_${message.id}`,
    });
  }

  await writeAudit({
    actorId: staff.id,
    action: "TICKET_REPLIED",
    entity: "Ticket",
    entityId: ticketId,
    meta: { messageId: message.id },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
  return { success: true, messageId: message.id };
}

/**
 * Adds an internal note to the ticket.
 * Visible ONLY to staff members. NEVER emailed, never returned to customers.
 */
export async function addInternalNote(ticketId: string, bodyText: string) {
  const staff = await requireStaff();
  const parsed = replyTicketSchema.parse({ body: bodyText });

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
  });

  if (!ticket) {
    throw new Error("Ticket not found.");
  }

  const now = new Date();
  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: "STAFF",
      authorUserId: staff.id,
      body: parsed.body,
      internal: true, // Internal only
      createdAt: now,
    },
  });

  await writeAudit({
    actorId: staff.id,
    action: "TICKET_NOTE_ADDED",
    entity: "Ticket",
    entityId: ticketId,
    meta: { messageId: message.id },
  });

  revalidatePath(`/admin/tickets/${ticketId}`);
  return { success: true, messageId: message.id };
}

/**
 * Staff query to list tickets with filters.
 */
export async function getAdminTickets(filters?: {
  status?: string;
  category?: string;
  overdueOnly?: boolean;
}) {
  await requireStaff();

  const where: Record<string, unknown> = {};

  if (filters?.status && filters.status !== "ALL") {
    where.status = filters.status;
  }
  if (filters?.category && filters.category !== "ALL") {
    where.category = filters.category;
  }

  const now = new Date();
  if (filters?.overdueOnly) {
    where.OR = [
      { ackDueAt: { lt: now }, acknowledgedAt: null },
      { resolveDueAt: { lt: now }, status: { notIn: ["RESOLVED", "CLOSED"] } },
    ];
  }

  return await prisma.ticket.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      _count: { select: { messages: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

/**
 * Staff query to fetch full ticket details including internal notes and staff authors.
 */
export async function getAdminTicketDetail(ticketId: string) {
  await requireStaff();

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      order: { select: { id: true, displayId: true, total: true, fulfilmentStatus: true, paymentStatus: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: {
        include: {
          authorUser: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return ticket;
}
