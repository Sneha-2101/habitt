"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { limit } from "@/lib/ratelimit";
import { headers } from "next/headers";
import { verifyTurnstile } from "@/lib/turnstile";
import { normalizeIdentifier, hashOtp } from "@/lib/otp";
import { otpIdentifierKey } from "@/lib/otp-identifier";
import { sendEmailOtp } from "@/lib/otp-email";
import {
  guestTicketSchema,
  replyTicketSchema,
  computeSlaDates,
  formatTicketNumber,
  generateGuestToken,
  verifyGuestToken,
} from "@/lib/tickets/rules";
import { canTicketTransition } from "@/lib/tickets/transitions";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { getSettings } from "@/lib/settings";
import type { TicketCategory } from "@prisma/client";

async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("cf-connecting-ip") ||
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "127.0.0.1"
    );
  } catch {
    return "127.0.0.1";
  }
}

export interface GuestTicketInput {
  email: string;
  code: string;
  name?: string;
  subject: string;
  body: string;
  category: TicketCategory;
  orderRef?: string | null;
  turnstileToken?: string;
}

/**
 * Sends a 6-digit verification code to the guest email.
 * ALWAYS returns the exact same neutral response to prevent account/email enumeration.
 */
export async function requestGuestTicketCode(email: string, turnstileToken?: string) {
  const ip = await getClientIp();

  // 1. Verify Turnstile
  const turnstileOk = await verifyTurnstile(turnstileToken, ip);
  if (!turnstileOk) {
    return {
      success: false,
      message: "Security check failed. Please refresh and try again.",
    };
  }

  const normalized = normalizeIdentifier(email, "EMAIL");
  if (!normalized || !normalized.includes("@")) {
    return {
      success: false,
      message: "Please enter a valid email address.",
    };
  }

  // 2. Rate limit by IP and by email
  const [ipLimit, emailLimit] = await Promise.all([
    limit("ticketGuestOtpIp", ip),
    limit("ticketGuestOtpEmail", otpIdentifierKey(normalized)),
  ]);

  if (!ipLimit.ok || !emailLimit.ok) {
    return {
      success: false,
      message: "Too many verification requests. Please wait a few minutes.",
    };
  }

  const identifier = `ticket_guest:${normalized}`;
  const identifierKey = otpIdentifierKey(identifier);
  const now = new Date();
  const sixtySecondsAgo = new Date(now.getTime() - 60 * 1000);

  // 60-second cooldown check
  const recent = await prisma.otpCode.findFirst({
    where: {
      identifier: identifierKey,
      channel: "EMAIL",
      verified: false,
      expiresAt: { gt: now },
      createdAt: { gt: sixtySecondsAgo },
    },
  });

  if (!recent) {
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min
    const hashedCode = hashOtp(identifier, code);

    await prisma.otpCode.create({
      data: {
        identifier: identifierKey,
        channel: "EMAIL",
        code: hashedCode,
        expiresAt,
      },
    });

    await sendEmailOtp(normalized, code);
  }

  // ALWAYS return identical neutral message
  return {
    success: true,
    message: "If this email address is valid, a 6-digit verification code has been sent.",
  };
}

/**
 * Creates a guest ticket after verifying the 6-digit email OTP.
 * Generates an access token and stores ONLY its SHA-256 hash.
 * If a registered user exists with that email, the ticket is STILL created as a guest ticket (never auto-merge).
 */
export async function createGuestTicket(input: GuestTicketInput) {
  const ip = await getClientIp();

  const ipCheck = await limit("ticketGuestCreateIp", ip);
  if (!ipCheck.ok) {
    throw new Error("Too many requests from your IP. Please wait before submitting another ticket.");
  }

  // Turnstile check
  if (input.turnstileToken) {
    const turnstileOk = await verifyTurnstile(input.turnstileToken, ip);
    if (!turnstileOk) {
      throw new Error("Security check failed. Please refresh and try again.");
    }
  }

  const parsed = guestTicketSchema.parse(input);
  const normalizedEmail = normalizeIdentifier(parsed.email, "EMAIL");
  const identifier = `ticket_guest:${normalizedEmail}`;
  const identifierKey = otpIdentifierKey(identifier);
  const now = new Date();

  // Verify OTP code
  const activeCode = await prisma.otpCode.findFirst({
    where: {
      identifier: identifierKey,
      channel: "EMAIL",
      verified: false,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!activeCode) {
    throw new Error("Invalid or expired verification code.");
  }

  // Atomic attempts increment (capped at 5)
  const updateAttempts = await prisma.otpCode.updateMany({
    where: {
      id: activeCode.id,
      verified: false,
      expiresAt: { gt: now },
      attempts: { lt: 5 },
    },
    data: {
      attempts: { increment: 1 },
    },
  });

  if (updateAttempts.count === 0) {
    throw new Error("Too many failed attempts. Please request a new code.");
  }

  const expectedHash = hashOtp(identifier, parsed.code);
  const actualBuffer = Buffer.from(activeCode.code, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  const isMatch =
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);

  if (!isMatch) {
    throw new Error("Invalid or expired verification code.");
  }

  // Single-use mark verified
  const markVerified = await prisma.otpCode.updateMany({
    where: { id: activeCode.id, verified: false },
    data: { verified: true },
  });

  if (markVerified.count !== 1) {
    throw new Error("Verification code has already been used.");
  }

  // Generate private guest access token and store ONLY its hash
  const { token, hash } = generateGuestToken();
  const { ackDueAt, resolveDueAt } = computeSlaDates(now);

  const { ticket, message } = await prisma.$transaction(async (tx) => {
    const seqRes: Array<{ nextval: bigint | number }> = await tx.$queryRaw`
      SELECT nextval('ticket_number_seq');
    `;
    const nextSeq = Number(seqRes[0].nextval);
    const ticketNumber = formatTicketNumber(nextSeq);

    const newTicket = await tx.ticket.create({
      data: {
        number: ticketNumber,
        userId: null, // Never auto-merge, even if email belongs to registered user
        guestEmail: normalizedEmail,
        guestName: parsed.name,
        guestVerifiedAt: now,
        accessTokenHash: hash,
        orderRef: parsed.orderRef || null,
        category: parsed.category,
        subject: parsed.subject,
        status: "OPEN",
        source: "GUEST_FORM",
        ackDueAt,
        resolveDueAt,
        createdAt: now,
      },
    });

    const firstMsg = await tx.ticketMessage.create({
      data: {
        ticketId: newTicket.id,
        authorType: "CUSTOMER",
        body: parsed.body,
        internal: false,
        createdAt: now,
      },
    });

    return { ticket: newTicket, message: firstMsg };
  });

  const settings = await getSettings();
  const supportEmail = settings.supportEmail?.trim() || process.env.SUPPORT_EMAIL?.trim() || null;

  // Outbox: Private View Link Email to Customer (token sent ONLY in outbox email payload)
  await enqueueOutbox({
    type: "TICKET_GUEST_LINK",
    channel: "EMAIL",
    payload: {
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      recipientEmail: normalizedEmail,
      customerName: parsed.name,
      subject: ticket.subject,
      token,
      viewUrl: `/ticket/${ticket.number}?t=${token}`,
    },
    dedupeKey: `ticket_guest_link_${ticket.id}`,
  });

  // Outbox: Customer Acknowledgement Email
  await enqueueOutbox({
    type: "TICKET_ACKNOWLEDGED",
    channel: "EMAIL",
    payload: {
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      recipientEmail: normalizedEmail,
      customerName: parsed.name,
      subject: ticket.subject,
      body: message.body,
    },
    dedupeKey: `ticket_ack_${ticket.id}`,
  });

  // Outbox: Support Team Notification
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
        subject: ticket.subject,
        category: ticket.category,
        customerName: parsed.name,
        customerEmail: normalizedEmail,
        body: message.body,
        isGrievance: ticket.category === "GRIEVANCE",
        recipientEmail: alertRecipient,
      },
      dedupeKey: `ticket_support_alert_${ticket.id}`,
    });
  } else {
    console.warn("[GuestTickets] Skipping TICKET_SUPPORT_ALERT: no supportEmail configured.");
  }

  return {
    success: true,
    ticketNumber: ticket.number,
    token,
    message: "Ticket submitted successfully. A private tracking link has been emailed to you.",
  };
}

/**
 * Retrieves a guest ticket by number and verifies the access token.
 * Generic null return on any mismatch prevents enumeration.
 */
export async function getGuestTicket(ticketNumber: string, token: string) {
  if (!ticketNumber || !token) return null;

  const ticket = await prisma.ticket.findUnique({
    where: { number: ticketNumber.trim() },
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      status: true,
      orderRef: true,
      guestName: true,
      accessTokenHash: true,
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
  });

  if (!ticket || !verifyGuestToken(token, ticket.accessTokenHash)) {
    return null;
  }

  return {
    id: ticket.id,
    number: ticket.number,
    ticketNumber: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    orderRef: ticket.orderRef,
    guestName: ticket.guestName,
    ackDueAt: ticket.ackDueAt,
    resolveDueAt: ticket.resolveDueAt,
    acknowledgedAt: ticket.acknowledgedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      author: m.authorType === "CUSTOMER" ? "You" : "Support team",
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

/**
 * Submits a reply to a guest ticket using the verified token.
 * Gives the exact same generic error for wrong ticket or wrong token.
 */
export async function guestReply(ticketNumber: string, token: string, bodyText: string) {
  const ip = await getClientIp();

  const rateCheck = await limit("ticketReply", ip);
  if (!rateCheck.ok) {
    throw new Error("Too many replies. Please wait a moment before replying again.");
  }

  const parsed = replyTicketSchema.parse({ body: bodyText });

  const ticket = await prisma.ticket.findUnique({
    where: { number: ticketNumber.trim() },
  });

  if (!ticket || !verifyGuestToken(token, ticket.accessTokenHash)) {
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
        body: parsed.body,
        internal: false,
        createdAt: now,
      },
    });

    return { ticket: updatedTicket, message: msg };
  });

  const settings = await getSettings();
  const supportEmail = settings.supportEmail?.trim() || process.env.SUPPORT_EMAIL?.trim() || null;

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
        customerName: ticket.guestName || "Guest",
        customerEmail: ticket.guestEmail || "No email",
        body: message.body,
        isGrievance: ticket.category === "GRIEVANCE",
        recipientEmail: alertRecipient,
      },
      dedupeKey: `ticket_reply_alert_${message.id}`,
    });
  } else {
    console.warn("[GuestTickets] Skipping TICKET_SUPPORT_ALERT reply: no supportEmail configured.");
  }

  return { success: true, messageId: message.id };
}
