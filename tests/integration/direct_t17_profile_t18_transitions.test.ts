import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows } from "../helpers/fixtures";
import { canTransition, canPaymentTransition } from "@/lib/orders/transitions";
import { FulfilmentStatus, PaymentStatus } from "@prisma/client";

// Setup mocks
let mockCurrentUser: { id: string; role: string } = { id: "default_user", role: "CUSTOMER" };

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { updateProfile } from "@/lib/actions/account";

describe("T17 & T18: Profile Phone Immunity & Transitions Matrix", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T17 profile: updateProfile with phone in FormData does NOT update user phone in DB", async () => {
    const originalPhone = "9876543210";
    const user = await createTestUser({
      name: "Original Name",
      phone: originalPhone,
    });
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const formData = new FormData();
    formData.append("name", "Updated Name");
    formData.append("phone", "9999999999"); // Attacker attempting phone takeover
    formData.append("dateOfBirth", "1995-05-15");

    await updateProfile(formData);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.name).toBe("Updated Name");
    expect(updatedUser?.dateOfBirth).toEqual(new Date("1995-05-15"));
    // SECURITY: phone MUST be untouched!
    expect(updatedUser?.phone).toBe(originalPhone);
  });

  it("T18 transitions: table test for every legal move and sample of illegal moves per payment method", () => {
    // 1. RAZORPAY legal moves
    const razorpayLegal: [FulfilmentStatus, FulfilmentStatus][] = [
      ["CREATED", "CANCELLED"],
      ["PLACED", "SHIPPED"],
      ["PLACED", "CANCELLED"],
      ["SHIPPED", "DELIVERED"],
      ["DELIVERED", "CANCELLED"],
    ];
    for (const [from, to] of razorpayLegal) {
      expect(canTransition("RAZORPAY", from, to), `RAZORPAY legal ${from}->${to}`).toBe(true);
    }

    // RAZORPAY illegal moves
    const razorpayIllegal: [FulfilmentStatus, FulfilmentStatus][] = [
      ["CREATED", "SHIPPED"],
      ["CREATED", "DELIVERED"],
      ["PLACED", "CREATED"],
      ["PLACED", "DELIVERED"],
      ["SHIPPED", "PLACED"],
      ["SHIPPED", "CANCELLED"],
      ["CANCELLED", "PLACED"],
      ["CANCELLED", "SHIPPED"],
      ["CANCELLED", "DELIVERED"],
      ["DELIVERED", "SHIPPED"],
      ["DELIVERED", "PLACED"],
    ];
    for (const [from, to] of razorpayIllegal) {
      expect(canTransition("RAZORPAY", from, to), `RAZORPAY illegal ${from}->${to}`).toBe(false);
    }

    // 2. COD legal moves
    const codLegal: [FulfilmentStatus, FulfilmentStatus][] = [
      ["PLACED", "SHIPPED"],
      ["PLACED", "CANCELLED"],
      ["SHIPPED", "DELIVERED"],
      ["SHIPPED", "CANCELLED"],
      ["DELIVERED", "CANCELLED"],
    ];
    for (const [from, to] of codLegal) {
      expect(canTransition("COD", from, to), `COD legal ${from}->${to}`).toBe(true);
    }

    // COD illegal moves
    const codIllegal: [FulfilmentStatus, FulfilmentStatus][] = [
      ["PLACED", "DELIVERED"],
      ["SHIPPED", "PLACED"],
      ["CANCELLED", "PLACED"],
      ["CANCELLED", "SHIPPED"],
      ["DELIVERED", "PLACED"],
      ["DELIVERED", "SHIPPED"],
    ];
    for (const [from, to] of codIllegal) {
      expect(canTransition("COD", from, to), `COD illegal ${from}->${to}`).toBe(false);
    }

    // 3. STORE_CREDIT legal moves
    const storeCreditLegal: [FulfilmentStatus, FulfilmentStatus][] = [
      ["PLACED", "SHIPPED"],
      ["PLACED", "CANCELLED"],
      ["SHIPPED", "DELIVERED"],
      ["DELIVERED", "CANCELLED"],
    ];
    for (const [from, to] of storeCreditLegal) {
      expect(canTransition("STORE_CREDIT", from, to), `STORE_CREDIT legal ${from}->${to}`).toBe(true);
    }

    // STORE_CREDIT illegal moves
    const storeCreditIllegal: [FulfilmentStatus, FulfilmentStatus][] = [
      ["CREATED", "PLACED"],
      ["CREATED", "SHIPPED"],
      ["SHIPPED", "PLACED"],
      ["SHIPPED", "CANCELLED"],
      ["CANCELLED", "PLACED"],
      ["CANCELLED", "SHIPPED"],
    ];
    for (const [from, to] of storeCreditIllegal) {
      expect(canTransition("STORE_CREDIT", from, to), `STORE_CREDIT illegal ${from}->${to}`).toBe(false);
    }

    // 4. Payment legal and illegal moves
    const paymentLegal: [PaymentStatus, PaymentStatus][] = [
      ["PENDING", "PAID"],
      ["PENDING", "FAILED"],
      ["FAILED", "PAID"],
      ["COD_PENDING", "COD_COLLECTED"],
      ["PAID", "PARTIALLY_REFUNDED"],
      ["PAID", "REFUNDED"],
    ];
    for (const [from, to] of paymentLegal) {
      expect(canPaymentTransition(from, to), `Payment legal ${from}->${to}`).toBe(true);
    }

    const paymentIllegal: [PaymentStatus, PaymentStatus][] = [
      ["PAID", "PENDING"],
      ["FAILED", "PENDING"],
      ["REFUNDED", "PAID"],
    ];
    for (const [from, to] of paymentIllegal) {
      expect(canPaymentTransition(from, to), `Payment illegal ${from}->${to}`).toBe(false);
    }
  });
});
