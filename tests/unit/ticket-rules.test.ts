import { describe, it, expect } from "vitest";
import {
  computeSlaDates,
  slaState,
  formatTicketNumber,
  parseTicketNumber,
  generateGuestToken,
  hashGuestToken,
  verifyGuestToken,
  createTicketSchema,
  replyTicketSchema,
  guestTicketSchema,
} from "@/lib/tickets/rules";
import { canTicketTransition } from "@/lib/tickets/transitions";

describe("Ticket Rules & Pure Invariants", () => {
  it("computeSlaDates calculates exactly +48h for ack and +30d for resolution", () => {
    const base = new Date("2026-11-22T10:00:00.000Z");
    const { ackDueAt, resolveDueAt } = computeSlaDates(base);

    expect(ackDueAt.toISOString()).toBe("2026-11-24T10:00:00.000Z");
    expect(resolveDueAt.toISOString()).toBe("2026-12-22T10:00:00.000Z");

    const ackDiffHours = (ackDueAt.getTime() - base.getTime()) / (1000 * 60 * 60);
    const resolveDiffDays = (resolveDueAt.getTime() - base.getTime()) / (1000 * 60 * 60 * 24);

    expect(ackDiffHours).toBe(48);
    expect(resolveDiffDays).toBe(30);
  });

  it("slaState handles boundaries at exactly 48h and 30 days", () => {
    const createdAt = new Date("2026-11-22T00:00:00.000Z");
    const { ackDueAt, resolveDueAt } = computeSlaDates(createdAt);

    // 47 hours later: not acknowledged, but not overdue yet
    const t47h = new Date("2026-11-23T23:00:00.000Z");
    const state47 = slaState({ ackDueAt, resolveDueAt, status: "OPEN" }, t47h);
    expect(state47.ackOverdue).toBe(false);
    expect(state47.hoursLeftToAck).toBe(1);

    // 49 hours later: not acknowledged -> ackOverdue is true
    const t49h = new Date("2026-11-24T01:00:00.000Z");
    const state49 = slaState({ ackDueAt, resolveDueAt, status: "OPEN" }, t49h);
    expect(state49.ackOverdue).toBe(true);

    // 49 hours later: acknowledged earlier -> ackOverdue is false
    const state49Ack = slaState(
      {
        ackDueAt,
        resolveDueAt,
        acknowledgedAt: new Date("2026-11-22T02:00:00.000Z"),
        status: "OPEN",
      },
      t49h
    );
    expect(state49Ack.ackOverdue).toBe(false);
    expect(state49Ack.isAcknowledged).toBe(true);

    // 28 days later: resolve due soon (< 3 days)
    const t28d = new Date("2026-12-20T00:00:00.000Z");
    const state28d = slaState({ ackDueAt, resolveDueAt, status: "IN_PROGRESS" }, t28d);
    expect(state28d.resolveOverdue).toBe(false);
    expect(state28d.resolveDueSoon).toBe(true);
    expect(state28d.daysLeftToResolve).toBe(2);

    // 31 days later: resolve overdue
    const t31d = new Date("2026-12-23T00:00:00.000Z");
    const state31d = slaState({ ackDueAt, resolveDueAt, status: "IN_PROGRESS" }, t31d);
    expect(state31d.resolveOverdue).toBe(true);

    // 31 days later, but resolved: not overdue
    const state31dResolved = slaState({ ackDueAt, resolveDueAt, status: "RESOLVED" }, t31d);
    expect(state31dResolved.resolveOverdue).toBe(false);
  });

  it("canTicketTransition enforces staff and customer rules", () => {
    // Staff transitions
    expect(canTicketTransition("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canTicketTransition("OPEN", "RESOLVED")).toBe(true);
    expect(canTicketTransition("IN_PROGRESS", "WAITING_CUSTOMER")).toBe(true);
    expect(canTicketTransition("WAITING_CUSTOMER", "RESOLVED")).toBe(true);
    expect(canTicketTransition("RESOLVED", "CLOSED")).toBe(true);
    expect(canTicketTransition("RESOLVED", "OPEN")).toBe(true); // Staff reopen
    expect(canTicketTransition("CLOSED", "OPEN")).toBe(false); // CLOSED terminal

    // Customer transitions
    const resolvedAt = new Date("2026-11-01T10:00:00.000Z");
    const day10 = new Date("2026-11-11T10:00:00.000Z"); // 10 days later <= 14 days
    const day16 = new Date("2026-11-17T10:00:00.000Z"); // 16 days later > 14 days

    expect(
      canTicketTransition("RESOLVED", "OPEN", {
        isCustomer: true,
        resolvedAt,
        now: day10,
      })
    ).toBe(true);

    expect(
      canTicketTransition("RESOLVED", "OPEN", {
        isCustomer: true,
        resolvedAt,
        now: day16,
      })
    ).toBe(false);

    expect(canTicketTransition("CLOSED", "OPEN", { isCustomer: true })).toBe(false);
    expect(canTicketTransition("OPEN", "RESOLVED", { isCustomer: true })).toBe(false);
  });

  it("formatTicketNumber and parseTicketNumber roundtrip", () => {
    expect(formatTicketNumber(1)).toBe("T-000001");
    expect(formatTicketNumber(123)).toBe("T-000123");
    expect(formatTicketNumber(999999)).toBe("T-999999");
    expect(formatTicketNumber(1000000)).toBe("T-1000000");

    expect(parseTicketNumber("T-000123")).toBe(123);
    expect(parseTicketNumber("T-000001")).toBe(1);
    expect(parseTicketNumber("INVALID")).toBeNull();
    expect(parseTicketNumber("T-12")).toBeNull();
  });

  it("generateGuestToken produces valid token and verifiable SHA-256 hash", () => {
    const { token, hash } = generateGuestToken();
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(hash).toBe(hashGuestToken(token));

    expect(verifyGuestToken(token, hash)).toBe(true);

    // Tampered token fails
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyGuestToken(tampered, hash)).toBe(false);

    // Empty or missing tokens fail
    expect(verifyGuestToken("", hash)).toBe(false);
    expect(verifyGuestToken(token, null)).toBe(false);
  });

  it("validation schemas reject illegal inputs", () => {
    // Subject validation (3..120)
    expect(createTicketSchema.safeParse({ subject: "ab", body: "valid body", category: "ORDER" }).success).toBe(false);
    expect(createTicketSchema.safeParse({ subject: "a".repeat(121), body: "valid body", category: "ORDER" }).success).toBe(false);
    expect(createTicketSchema.safeParse({ subject: "Valid Subject", body: "valid body", category: "ORDER" }).success).toBe(true);

    // Body validation (1..5000)
    expect(replyTicketSchema.safeParse({ body: "" }).success).toBe(false);
    expect(replyTicketSchema.safeParse({ body: "a".repeat(5001) }).success).toBe(false);
    expect(replyTicketSchema.safeParse({ body: "Valid reply" }).success).toBe(true);

    // Category enum validation
    expect(createTicketSchema.safeParse({ subject: "Valid Subject", body: "valid", category: "NOT_A_CATEGORY" }).success).toBe(false);
    expect(createTicketSchema.safeParse({ subject: "Valid Subject", body: "valid", category: "GRIEVANCE" }).success).toBe(true);

    // Guest ticket schema requires email, code, name
    expect(
      guestTicketSchema.safeParse({
        email: "not-an-email",
        code: "123456",
        name: "Test",
        subject: "Help",
        body: "Need help",
        category: "ORDER",
      }).success
    ).toBe(false);

    expect(
      guestTicketSchema.safeParse({
        email: "guest@example.com",
        code: "123", // too short
        name: "Test",
        subject: "Help",
        body: "Need help",
        category: "ORDER",
      }).success
    ).toBe(false);

    expect(
      guestTicketSchema.safeParse({
        email: "guest@example.com",
        code: "123456",
        name: "Guest User",
        subject: "Help with delivery",
        body: "My order has not arrived",
        category: "ORDER",
      }).success
    ).toBe(true);
  });
});
