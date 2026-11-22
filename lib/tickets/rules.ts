import crypto from "crypto";
import { z } from "zod";
import type { TicketStatus } from "@prisma/client";

export const TICKET_CATEGORIES = [
  "ORDER",
  "PAYMENT",
  "RETURN_REFUND",
  "PRODUCT",
  "ACCOUNT",
  "GRIEVANCE",
  "OTHER",
] as const;

export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;

export const createTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(120, "Subject cannot exceed 120 characters"),
  body: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(5000, "Message cannot exceed 5000 characters"),
  category: z.enum(TICKET_CATEGORIES, {
    errorMap: () => ({ message: "Please select a valid ticket category" }),
  }),
  orderId: z.string().trim().optional().nullable(),
  orderRef: z.string().trim().max(100).optional().nullable(),
});

export const replyTicketSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(5000, "Message cannot exceed 5000 characters"),
});

export const guestTicketSchema = createTicketSchema.extend({
  email: z.string().trim().email("Please enter a valid email address"),
  code: z.string().trim().min(6).max(6),
  name: z.string().trim().min(1).max(100).optional().default("Guest"),
  turnstileToken: z.string().trim().optional(),
});

export interface TicketSlaDates {
  ackDueAt: Date;
  resolveDueAt: Date;
}

/**
 * Computes statutory SLA due dates:
 * - Acknowledged within 48 hours
 * - Resolved within 30 days (1 month)
 */
export function computeSlaDates(createdAt: Date = new Date()): TicketSlaDates {
  const ackDueAt = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);
  const resolveDueAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { ackDueAt, resolveDueAt };
}

export interface TicketSlaState {
  isAcknowledged: boolean;
  isResolved: boolean;
  ackOverdue: boolean;
  resolveOverdue: boolean;
  resolveDueSoon: boolean; // Due in <= 3 days
  hoursLeftToAck: number;
  hoursLeftToResolve: number;
  daysLeftToResolve: number;
}

export function slaState(
  ticket: {
    ackDueAt: Date;
    resolveDueAt: Date;
    acknowledgedAt?: Date | null;
    status: TicketStatus;
  },
  now: Date = new Date()
): TicketSlaState {
  const isAcknowledged = Boolean(ticket.acknowledgedAt);
  const isResolved = ticket.status === "RESOLVED" || ticket.status === "CLOSED";

  const ackDiffMs = ticket.ackDueAt.getTime() - now.getTime();
  const resolveDiffMs = ticket.resolveDueAt.getTime() - now.getTime();

  const ackOverdue = !isAcknowledged && ackDiffMs < 0;
  const resolveOverdue = !isResolved && resolveDiffMs < 0;
  const resolveDueSoon = !isResolved && !resolveOverdue && resolveDiffMs <= 3 * 24 * 60 * 60 * 1000;

  return {
    isAcknowledged,
    isResolved,
    ackOverdue,
    resolveOverdue,
    resolveDueSoon,
    hoursLeftToAck: Math.round(ackDiffMs / (1000 * 60 * 60)),
    hoursLeftToResolve: Math.round(resolveDiffMs / (1000 * 60 * 60)),
    daysLeftToResolve: Math.ceil(resolveDiffMs / (1000 * 60 * 60 * 24)),
  };
}

/**
 * Formats a sequence number into standard ticket number: T-000123
 */
export function formatTicketNumber(seq: number): string {
  return `T-${String(seq).padStart(6, "0")}`;
}

/**
 * Parses sequence number from ticket number (e.g. T-000123 -> 123)
 */
export function parseTicketNumber(numberStr: string): number | null {
  const match = /^T-(\d{6,})$/.exec(numberStr.trim());
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Generates cryptographically secure 32-byte guest access token and its SHA-256 hash.
 */
export function generateGuestToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = hashGuestToken(token);
  return { token, hash };
}

/**
 * Computes SHA-256 hex hash of the guest token.
 */
export function hashGuestToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Validates a plaintext guest token against the stored SHA-256 hash using timingSafeEqual.
 */
export function verifyGuestToken(providedToken: string, storedHash?: string | null): boolean {
  if (!providedToken || !storedHash) return false;
  try {
    const computedHash = hashGuestToken(providedToken);
    const bufA = Buffer.from(computedHash, "hex");
    const bufB = Buffer.from(storedHash, "hex");
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
