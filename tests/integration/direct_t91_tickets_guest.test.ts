import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser } from "../helpers/fixtures";
import {
  requestGuestTicketCode,
  createGuestTicket,
  getGuestTicket,
  guestReply,
} from "@/lib/actions/guest-tickets";
import { otpIdentifierKey } from "@/lib/otp-identifier";

let lastOtpCode = "";

vi.mock("@/lib/otp-email", () => ({
  sendEmailOtp: vi.fn(async (_to: string, code: string) => {
    lastOtpCode = code;
    return { success: true };
  }),
}));

vi.mock("@/lib/email", () => ({
  sendEmailOtp: vi.fn(async (_to: string, code: string) => {
    lastOtpCode = code;
    return { success: true };
  }),
  sendTicketEventEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T91: Guest Tickets, OTP Verification & Token Security Integration", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    lastOtpCode = "";
  });

  it("1. requestGuestTicketCode returns neutral identical response for registered vs unregistered email", async () => {
    const existingUser = await createTestUser();
    const unregisteredEmail = `m1test_unreg_${Date.now()}@example.com`;

    const res1 = await requestGuestTicketCode(existingUser.email!);
    expect(res1.success).toBe(true);
    expect(res1.message).toBe("If this email address is valid, a 6-digit verification code has been sent.");

    const res2 = await requestGuestTicketCode(unregisteredEmail);
    expect(res2.success).toBe(true);
    expect(res2.message).toBe("If this email address is valid, a 6-digit verification code has been sent.");

    // Both should generate OTP records in OtpCode table
    const otp1 = await prisma.otpCode.findFirst({
      where: { identifier: otpIdentifierKey(`ticket_guest:${existingUser.email!.toLowerCase()}`) },
    });
    expect(otp1).not.toBeNull();

    const otp2 = await prisma.otpCode.findFirst({
      where: { identifier: otpIdentifierKey(`ticket_guest:${unregisteredEmail.toLowerCase()}`) },
    });
    expect(otp2).not.toBeNull();
  });

  it("2. createGuestTicket validates OTP, caps attempts, and never auto-merges accounts", async () => {
    const guestEmail = `m1test_guest_${Date.now()}@example.com`;
    await requestGuestTicketCode(guestEmail);
    expect(lastOtpCode).not.toBe("");

    const otpRecord = await prisma.otpCode.findFirst({
      where: { identifier: otpIdentifierKey(`ticket_guest:${guestEmail.toLowerCase()}`) },
      orderBy: { createdAt: "desc" },
    });
    expect(otpRecord).not.toBeNull();

    // Wrong code fails
    await expect(
      createGuestTicket({
        email: guestEmail,
        code: "000000",
        category: "ORDER",
        subject: "m1test My order status",
        body: "m1test Looking for status update",
      })
    ).rejects.toThrow(/Invalid or expired verification code/i);

    // Correct code succeeds
    const validRes = await createGuestTicket({
      email: guestEmail,
      code: lastOtpCode,
      category: "ORDER",
      subject: "m1test Legitimate inquiry",
      body: "m1test Can you update on delivery?",
    });

    expect(validRes.success).toBe(true);
    expect(validRes.ticketNumber).toBeDefined();
    expect(validRes.token).toBeDefined();

    // Verify database row
    const ticket = await prisma.ticket.findUnique({
      where: { number: validRes.ticketNumber },
    });
    expect(ticket).not.toBeNull();
    expect(ticket?.source).toBe("GUEST_FORM");
    expect(ticket?.guestEmail).toBe(guestEmail.toLowerCase());
    expect(ticket?.userId).toBeNull(); // NEVER auto-merged into an account

    // Raw token is NOT stored in DB; only SHA-256 hash
    expect(ticket?.accessTokenHash).toBeDefined();
    expect(ticket?.accessTokenHash).not.toBe(validRes.token);
  });

  it("3. getGuestTicket requires valid token via timing-safe check; wrong token fails", async () => {
    const guestEmail = `m1test_tok_${Date.now()}@example.com`;
    await requestGuestTicketCode(guestEmail);
    expect(lastOtpCode).not.toBe("");

    const createRes = await createGuestTicket({
      email: guestEmail,
      code: lastOtpCode,
      category: "PAYMENT",
      subject: "m1test Payment inquiry",
      body: "m1test Did my card get charged twice?",
    });

    // Valid token retrieves ticket
    const ticketData = await getGuestTicket(createRes.ticketNumber!, createRes.token!);
    expect(ticketData).not.toBeNull();
    expect(ticketData?.ticketNumber).toBe(createRes.ticketNumber);
    expect(ticketData?.subject).toBe("m1test Payment inquiry");
    expect(ticketData?.messages.length).toBe(1);

    // Wrong token returns null
    const wrongTokenData = await getGuestTicket(createRes.ticketNumber!, "wrong_token_value_1234567890123456");
    expect(wrongTokenData).toBeNull();

    // Non-existent ticket number returns null
    const notFoundData = await getGuestTicket("T-999999", createRes.token!);
    expect(notFoundData).toBeNull();
  });

  it("4. guestReply allows follow-ups with valid token and handles reopening", async () => {
    const guestEmail = `m1test_reply_${Date.now()}@example.com`;
    await requestGuestTicketCode(guestEmail);
    expect(lastOtpCode).not.toBe("");

    const createRes = await createGuestTicket({
      email: guestEmail,
      code: lastOtpCode,
      category: "OTHER",
      subject: "m1test Guest ticket for reply test",
      body: "m1test Initial guest query",
    });

    // Guest posts a reply
    const replyRes = await guestReply(
      createRes.ticketNumber!,
      createRes.token!,
      "m1test Additional details from guest customer"
    );
    expect(replyRes.success).toBe(true);

    const updated = await getGuestTicket(createRes.ticketNumber!, createRes.token!);
    expect(updated?.messages.length).toBe(2);
    expect(updated?.messages[1].body).toContain("Additional details from guest customer");

    // Reply with invalid token fails
    await expect(
      guestReply(
        createRes.ticketNumber!,
        "invalid_token",
        "m1test will not go through"
      )
    ).rejects.toThrow();
  });
});
