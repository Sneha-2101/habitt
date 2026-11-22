import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createTicket, replyToTicket, getCustomerTickets } from "@/lib/actions/tickets";

let mockCurrentUser: { id: string; email: string; role: "CUSTOMER" | "STAFF" | "OWNER"; name?: string | null };

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T90: Customer Tickets Lifecycle & Privacy Integration", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("1. Customer can create ticket, computes +48h ackDueAt and +30d resolveDueAt, and enqueues outbox event", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, email: user.email!, role: "CUSTOMER", name: user.name };

    const res = await createTicket({
      category: "ORDER",
      subject: "m1test where is my package?",
      body: "m1test I placed an order yesterday and want an update.",
    });

    expect(res.success).toBe(true);
    expect(res.ticket.number).toMatch(/^T-\d{6}$/);

    const ticket = await prisma.ticket.findUnique({
      where: { id: res.ticket.id },
      include: { messages: true },
    });
    expect(ticket).not.toBeNull();
    expect(ticket?.subject).toBe("m1test where is my package?");
    expect(ticket?.status).toBe("OPEN");
    expect(ticket?.source).toBe("ACCOUNT");
    expect(ticket?.userId).toBe(user.id);

    // Verify SLA dates (+48h, +30d)
    const ackDiffHours = (ticket!.ackDueAt.getTime() - ticket!.createdAt.getTime()) / (1000 * 60 * 60);
    expect(Math.round(ackDiffHours)).toBe(48);

    const resolveDiffDays = (ticket!.resolveDueAt.getTime() - ticket!.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(resolveDiffDays)).toBe(30);

    // Initial message created
    expect(ticket?.messages.length).toBe(1);
    expect(ticket?.messages[0].authorType).toBe("CUSTOMER");
    expect(ticket?.messages[0].internal).toBe(false);

    // Outbox event enqueued
    const outbox = await prisma.eventOutbox.findFirst({
      where: {
        type: "TICKET_ACKNOWLEDGED",
        dedupeKey: `ticket_ack_${ticket!.id}`,
      },
    });
    expect(outbox).not.toBeNull();
    expect(outbox?.channel).toBe("EMAIL");
  });

  it("2. Customer can link ticket to own order, but linking to foreign order is rejected", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const { product, variants } = await createTestProduct();

    const orderA = await createTestOrder({
      userId: userA.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });
    const orderB = await createTestOrder({
      userId: userB.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });

    // Customer A creates ticket linking to own orderA
    mockCurrentUser = { id: userA.id, email: userA.email!, role: "CUSTOMER", name: userA.name };
    const resA = await createTicket({
      category: "RETURN_REFUND",
      subject: "m1test Return request for my order",
      body: "m1test Size does not fit",
      orderId: orderA.id,
    });
    expect(resA.success).toBe(true);
    const dbTicketA = await prisma.ticket.findUnique({ where: { id: resA.ticket.id } });
    expect(dbTicketA?.orderId).toBe(orderA.id);

    // Customer A tries to link orderB belonging to Customer B
    await expect(
      createTicket({
        category: "RETURN_REFUND",
        subject: "m1test Trying to access foreign order",
        body: "m1test invalid attempt",
        orderId: orderB.id,
      })
    ).rejects.toThrow(/Order not found or does not belong to you/i);
  });

  it("3. Customer reply reopens RESOLVED ticket within 14 days, but rejects replies on CLOSED tickets", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, email: user.email!, role: "CUSTOMER", name: user.name };

    const { ticket } = await createTicket({
      category: "OTHER",
      subject: "m1test Need help",
      body: "m1test initial question",
    });

    // Mark ticket as RESOLVED 2 days ago
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });

    // Customer replies -> should reopen to OPEN / WAITING_CUSTOMER
    const replyRes = await replyToTicket(ticket.id, "m1test Actually I still have an issue with this.");
    expect(replyRes.success).toBe(true);

    const reopened = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(reopened?.status).toBe("OPEN");
    expect(reopened?.messages.length).toBe(2);
    expect(reopened?.messages[1].body).toContain("Actually I still have an issue");

    // Close ticket permanently
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });

    // Reply should now be rejected
    await expect(
      replyToTicket(ticket.id, "m1test Trying to reply to closed ticket")
    ).rejects.toThrow(/Cannot reply to a closed ticket/i);
  });

  it("4. Customer queries never expose internal notes or staff identities", async () => {
    const user = await createTestUser();
    const staff = await createTestUser({ role: "STAFF" });
    mockCurrentUser = { id: user.id, email: user.email!, role: "CUSTOMER", name: user.name };

    const { ticket } = await createTicket({
      category: "PRODUCT",
      subject: "m1test Fabric query",
      body: "m1test Tell me about cotton blend",
    });

    // Staff adds customer-visible reply
    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: "STAFF",
        authorUserId: staff.id,
        body: "m1test It is 100% organic cotton.",
        internal: false,
      },
    });

    // Staff adds internal note (must never leak)
    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: "STAFF",
        authorUserId: staff.id,
        body: "m1test Confidential supplier review note",
        internal: true,
      },
    });

    // Customer loads their tickets
    const customerTickets = await getCustomerTickets();
    const found = customerTickets.find((t) => t.id === ticket.id);
    expect(found).toBeDefined();

    // Messages should NOT contain the internal note
    expect(found?.messages.length).toBe(2);
    const hasInternalNote = found?.messages.some((m) => m.body.includes("Confidential"));
    expect(hasInternalNote).toBe(false);

    // Staff ID should never appear
    const messageJson = JSON.stringify(found?.messages);
    expect(messageJson).not.toContain(staff.id);
  });
});
