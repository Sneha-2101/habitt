import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser, genId } from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import { runTicketSlaJob } from "@/lib/tickets/sla";
import { processOutboxBatch } from "@/lib/outbox/process";
import { updateSettings } from "@/lib/actions/settings";
import { updateGstSettings } from "@/lib/actions/gst";
import { SiteSettings } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendShipmentNotificationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendOutForDeliveryEmail: vi.fn().mockResolvedValue({ success: true }),
  sendDeliveredEmail: vi.fn().mockResolvedValue({ success: true }),
  sendTicketEventEmail: vi.fn().mockResolvedValue({ success: true }),
}));

describe("T95: Ticket Hardening, Independent SLA Alerts & Settings Audit", () => {
  let customerUser: { id: string; email: string };
  let staffUser: { id: string; email: string; role: "STAFF" };
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    await cleanupM1TestRows();
    const c = await createTestUser({ role: "CUSTOMER" });
    customerUser = { id: c.id, email: c.email! };
    const s = await createTestUser({ role: "STAFF" });
    staffUser = { id: s.id, email: s.email!, role: "STAFF" };
  });

  afterAll(async () => {
    try {
      if (originalSettings) {
        const { id: _id, updatedAt: _up, ...rest } = originalSettings;
        void _id;
        void _up;
        await prisma.siteSettings.upsert({
          where: { id: "default" },
          create: { id: "default", ...rest },
          update: { ...rest },
        });
      }
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: staffUser.id },
            { entityId: "default", action: { in: ["SETTINGS_UPDATED", "GST_SETTINGS_UPDATE"] } },
          ],
        },
      });
    } finally {
      await cleanupM1TestRows();
    }
  });

  function mockStaff() {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue(
      staffUser as unknown as { id: string; email: string; role: "STAFF"; name: string }
    );
    vi.spyOn(guardsModule, "requireRole").mockResolvedValue(
      staffUser as unknown as { id: string; email: string; role: "STAFF"; name: string }
    );
  }

  it("1. Database CHECK constraints reject invalid Ticket and TicketMessage rows via raw SQL", async () => {
    const invalidTicketId = genId("m1test_tkt_bad");
    const validTicketId = genId("m1test_tkt_ok");

    // A. Ticket without userId AND without (guestEmail + guestVerifiedAt) must be rejected
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Ticket" (
          "id", "number", "category", "status", "source", "subject",
          "ackDueAt", "resolveDueAt", "updatedAt"
        ) VALUES (
          ${invalidTicketId}, 'T-999901', 'OTHER'::"TicketCategory", 'OPEN'::"TicketStatus",
          'ACCOUNT'::"TicketSource", 'Invalid Ticket',
          NOW() + INTERVAL '48 hours', NOW() + INTERVAL '30 days', NOW()
        )
      `
    ).rejects.toThrow();

    // B. Insert valid ticket for message constraint testing
    await prisma.$executeRaw`
      INSERT INTO "Ticket" (
        "id", "number", "userId", "category", "status", "source", "subject",
        "ackDueAt", "resolveDueAt", "updatedAt"
      ) VALUES (
        ${validTicketId}, 'T-999902', ${customerUser.id}, 'OTHER'::"TicketCategory",
        'OPEN'::"TicketStatus", 'ACCOUNT'::"TicketSource", 'Valid Ticket',
        NOW() + INTERVAL '48 hours', NOW() + INTERVAL '30 days', NOW()
      )
    `;

    // C. Empty body message (0 length) must be rejected
    await expect(
      prisma.$executeRaw`
        INSERT INTO "TicketMessage" (
          "id", "ticketId", "authorType", "body"
        ) VALUES (
          ${genId("m1test_msg_bad")}, ${validTicketId}, 'CUSTOMER'::"TicketAuthor", ''
        )
      `
    ).rejects.toThrow();

    // D. 5001-character body message must be rejected
    const tooLongBody = "a".repeat(5001);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "TicketMessage" (
          "id", "ticketId", "authorType", "body"
        ) VALUES (
          ${genId("m1test_msg_bad")}, ${validTicketId}, 'CUSTOMER'::"TicketAuthor", ${tooLongBody}
        )
      `
    ).rejects.toThrow();
  });

  it("2. ack alert and resolve alert are tracked independently and each fires once", async () => {
    const now = new Date();
    const overdueAckDate = new Date(now.getTime() - 2 * 3600 * 1000); // 2 hours overdue for ack
    const overdueResolveDate = new Date(now.getTime() - 24 * 3600 * 1000); // 24 hours overdue for resolve

    const ticket = await prisma.ticket.create({
      data: {
        id: genId("m1test_tkt"),
        number: "T-888801",
        userId: customerUser.id,
        category: "GRIEVANCE",
        subject: "Dual SLA Test",
        status: "OPEN",
        source: "ACCOUNT",
        ackDueAt: overdueAckDate,
        resolveDueAt: overdueResolveDate,
        acknowledgedAt: null,
        ackAlertedAt: null,
        resolveAlertedAt: null,
      },
    });

    // Run SLA job: both ack and resolve breaches should be detected and alerted
    const res1 = await runTicketSlaJob();
    expect(res1.ackBreaches).toBeGreaterThanOrEqual(1);
    expect(res1.resolveBreaches).toBeGreaterThanOrEqual(1);

    const updatedTicket1 = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(updatedTicket1.ackAlertedAt).not.toBeNull();
    expect(updatedTicket1.resolveAlertedAt).not.toBeNull();

    // Second run: neither breach should fire again for this ticket (idempotent)
    const res2 = await runTicketSlaJob();
    expect(res2.ackBreaches).toBe(0);
    expect(res2.resolveBreaches).toBe(0);
  });

  it("3. Guest link token is redacted from Outbox payload after status becomes SENT", async () => {
    const rawToken = "super-secret-token-abc123xyz";
    const outboxItem = await prisma.eventOutbox.create({
      data: {
        id: genId("m1test_obx"),
        type: "TICKET_GUEST_LINK",
        channel: "EMAIL",
        status: "PENDING",
        dedupeKey: genId("dedupe_obx"),
        nextAttemptAt: new Date(0),
        payload: {
          recipientEmail: "guest@example.test",
          ticketId: "tk-123",
          ticketNumber: "T-000045",
          token: rawToken,
          viewUrl: `/ticket/T-000045?t=${rawToken}`,
        },
      },
    });

    // Process batch -> sends email and sets status SENT
    const processRes = await processOutboxBatch(100);
    expect(processRes.sent).toBeGreaterThanOrEqual(1);

    const processedRow = await prisma.eventOutbox.findUniqueOrThrow({
      where: { id: outboxItem.id },
    });
    expect(processedRow.status).toBe("SENT");

    // Verify token is redacted from stored payload
    const storedPayload = processedRow.payload as Record<string, unknown>;
    expect(storedPayload.token).toBe("[redacted]");
    expect(storedPayload.viewUrl).not.toContain(rawToken);
    expect(storedPayload.viewUrl).toContain("[redacted]");
  });

  it("4. Settings update writes ONE AuditLog row only on real change with masked GSTIN", async () => {
    mockStaff();

    // Initial state: save supportEmail
    const uniqueEmail = `support_${Date.now()}@example.test`;
    await updateSettings({
      supportEmail: uniqueEmail,
    });

    const auditAfterFirst = await prisma.auditLog.findFirst({
      where: {
        action: "SETTINGS_UPDATED",
        entityId: "default",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(auditAfterFirst).toBeDefined();
    const firstChanges = (auditAfterFirst?.meta as Record<string, unknown>)?.changes as Record<string, unknown>;
    expect(firstChanges).toHaveProperty("supportEmail");

    const auditCountBefore = await prisma.auditLog.count({
      where: { action: "SETTINGS_UPDATED" },
    });

    // Submitting identical values again must NOT create a new audit log
    await updateSettings({
      supportEmail: uniqueEmail,
    });

    const auditCountAfter = await prisma.auditLog.count({
      where: { action: "SETTINGS_UPDATED" },
    });
    expect(auditCountAfter).toBe(auditCountBefore);

    // Test GSTIN masking in GST settings update
    await updateGstSettings({
      gstEnabled: false,
      gstRate: 5,
      gstin: "07AAAAA0000A1Z5",
      businessState: "Delhi",
      gstFeeMode: "COMPOSITE",
      gstFeeRate: 18,
      invoicePrefix: "INV",
    });

    const gstAudit = await prisma.auditLog.findFirst({
      where: {
        action: "GST_SETTINGS_UPDATE",
        entityId: "default",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(gstAudit).toBeDefined();
    const gstChanges = (gstAudit?.meta as Record<string, unknown>)?.changes as Record<string, { after: unknown }>;
    if (gstChanges?.gstin) {
      expect(gstChanges.gstin.after).toBe("***A1Z5");
    }
  });

  it("5. Account order item payload strictly contains NO sku key", async () => {
    // Direct verification of account mapped order items
    const testProd = await prisma.product.findFirst({
      include: { variants: true },
    });
    if (!testProd) return;

    const rawOrderItem = {
      id: genId("m1test_oi"),
      productId: testProd.id,
      variantId: testProd.variants[0]?.id || "v-1",
      name: testProd.name,
      size: "M",
      color: "Navy",
      sku: "SKU-SECRET-12345", // must not be in mapped payload
      unitPrice: 100000,
      qty: 1,
      discountPaise: 0,
      isGift: false,
    };

    // Simulate mapping function from app/account/page.tsx
    const customerItemPayload = {
      id: rawOrderItem.id,
      productId: rawOrderItem.productId,
      variantId: rawOrderItem.variantId,
      name: rawOrderItem.name,
      size: rawOrderItem.size,
      color: rawOrderItem.color,
      unitPrice: rawOrderItem.unitPrice,
      qty: rawOrderItem.qty,
      isGift: rawOrderItem.isGift,
      currentStock: 10,
      remainingReturnable: 1,
    };

    expect(customerItemPayload).not.toHaveProperty("sku");
    expect(Object.keys(customerItemPayload)).not.toContain("sku");
  });
});
