import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser } from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import { ForbiddenError } from "@/lib/guards";
import {
  assignTicket,
  setTicketStatus,
  staffReply,
  addInternalNote,
  getAdminTickets,
  getAdminTicketDetail,
} from "@/lib/actions/admin-tickets";
import { runTicketSlaJob } from "@/lib/tickets/sla";
import { GET as ticketSlaCron } from "@/app/api/cron/ticket-sla/route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T92: Staff Ticket Actions, Audit Trail & SLA Cron Integration", () => {
  const originalEnv = { ...process.env };
  let staffUser: { id: string; email: string; role: "STAFF"; name: string };
  let customerUser: { id: string; email: string; role: "CUSTOMER"; name: string };

  beforeAll(async () => {
    await cleanupM1TestRows();
    const s = await createTestUser({ role: "STAFF" });
    staffUser = { id: s.id, email: s.email!, role: "STAFF", name: s.name! };
    const c = await createTestUser({ role: "CUSTOMER" });
    customerUser = { id: c.id, email: c.email!, role: "CUSTOMER", name: c.name! };
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function mockStaff() {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue(
      staffUser as unknown as { id: string; email: string; role: "STAFF"; name: string }
    );
    vi.spyOn(guardsModule, "requireRole").mockResolvedValue(
      staffUser as unknown as { id: string; email: string; role: "STAFF"; name: string }
    );
  }

  function mockCustomer() {
    vi.spyOn(guardsModule, "requireStaff").mockRejectedValue(new ForbiddenError("Staff access required"));
    vi.spyOn(guardsModule, "requireRole").mockRejectedValue(new ForbiddenError("Staff access required"));
  }

  it("1. Non-staff is strictly rejected from all admin ticket actions", async () => {
    mockCustomer();

    await expect(getAdminTickets()).rejects.toThrow(ForbiddenError);
    await expect(getAdminTicketDetail("any-id")).rejects.toThrow(ForbiddenError);
    await expect(assignTicket("any-id", "staff-id")).rejects.toThrow(ForbiddenError);
    await expect(setTicketStatus("any-id", "IN_PROGRESS")).rejects.toThrow(ForbiddenError);
    await expect(staffReply("any-id", "test reply")).rejects.toThrow(ForbiddenError);
    await expect(addInternalNote("any-id", "internal note")).rejects.toThrow(ForbiddenError);
  });

  it("2. Staff can assign, update status, reply, and add internal notes with full audit logging", async () => {
    mockStaff();

    // Create a ticket directly in DB for testing
    const now = new Date();
    const ticket = await prisma.ticket.create({
      data: {
        number: `TK-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        category: "ORDER",
        subject: "m1test Staff actions test ticket",
        status: "OPEN",
        source: "ACCOUNT",
        userId: customerUser.id,
        ackDueAt: new Date(now.getTime() + 48 * 3600 * 1000),
        resolveDueAt: new Date(now.getTime() + 30 * 86400 * 1000),
      },
    });

    // 1. Assign ticket
    const assignRes = await assignTicket(ticket.id, staffUser.id);
    expect(assignRes.success).toBe(true);
    expect(assignRes.ticket.assignedToId).toBe(staffUser.id);

    const assignAudit = await prisma.auditLog.findFirst({
      where: {
        action: "TICKET_ASSIGNED",
        entityId: ticket.id,
      },
    });
    expect(assignAudit).not.toBeNull();
    expect(assignAudit?.actorId).toBe(staffUser.id);

    // 2. Staff reply
    const replyRes = await staffReply(ticket.id, "m1test We are looking into your shipment right now.");
    expect(replyRes.success).toBe(true);

    const replyAudit = await prisma.auditLog.findFirst({
      where: {
        action: "TICKET_REPLIED",
        entityId: ticket.id,
      },
    });
    expect(replyAudit).not.toBeNull();

    // 3. Add internal note
    const noteRes = await addInternalNote(ticket.id, "m1test Courier escalated ticket via phone.");
    expect(noteRes.success).toBe(true);
    const dbNote = await prisma.ticketMessage.findUnique({ where: { id: noteRes.messageId } });
    expect(dbNote?.internal).toBe(true);
    expect(dbNote?.authorType).toBe("STAFF");

    const noteAudit = await prisma.auditLog.findFirst({
      where: {
        action: "TICKET_NOTE_ADDED",
        entityId: ticket.id,
      },
    });
    expect(noteAudit).not.toBeNull();

    // 4. Update status to RESOLVED
    const statusRes = await setTicketStatus(ticket.id, "RESOLVED");
    expect(statusRes.success).toBe(true);
    expect(statusRes.ticket.status).toBe("RESOLVED");
    expect(statusRes.ticket.resolvedAt).not.toBeNull();

    const statusAudit = await prisma.auditLog.findFirst({
      where: {
        action: "TICKET_STATUS_UPDATED",
        entityId: ticket.id,
      },
    });
    expect(statusAudit).not.toBeNull();
  });

  it("3. SLA cron endpoint authentication: 500 when unset, 401 on wrong Bearer, 200 on valid", async () => {
    // A. When CRON_SECRET is unset
    delete process.env.CRON_SECRET;
    const req1 = new Request("http://localhost/api/cron/ticket-sla");
    const res1 = await ticketSlaCron(req1);
    expect(res1.status).toBe(500);

    // B. When CRON_SECRET is set but header is missing/wrong
    process.env.CRON_SECRET = "m1test_cron_secret_secure_value";
    const req2 = new Request("http://localhost/api/cron/ticket-sla");
    const res2 = await ticketSlaCron(req2);
    expect(res2.status).toBe(401);

    const req3 = new Request("http://localhost/api/cron/ticket-sla", {
      headers: { authorization: "Bearer wrong_secret" },
    });
    const res3 = await ticketSlaCron(req3);
    expect(res3.status).toBe(401);

    // C. Valid Bearer token
    const req4 = new Request("http://localhost/api/cron/ticket-sla", {
      headers: { authorization: "Bearer m1test_cron_secret_secure_value" },
    });
    const res4 = await ticketSlaCron(req4);
    expect(res4.status).toBe(200);

    // CronRun entry was written
    const cronRun = await prisma.cronRun.findFirst({
      where: { job: "ticket-sla" },
      orderBy: { startedAt: "desc" },
    });
    expect(cronRun).not.toBeNull();
    expect(cronRun?.ok).toBe(true);
  });

  it("4. runTicketSlaJob identifies SLA breaches, enqueues alerts, and dedupes multiple runs", async () => {
    const now = new Date();
    // Overdue ticket: unacknowledged past ackDueAt (ackDueAt was 2 hours ago)
    const overdueTicket = await prisma.ticket.create({
      data: {
        number: `TK-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        category: "GRIEVANCE",
        subject: "m1test Unacknowledged grievance",
        status: "OPEN",
        source: "ACCOUNT",
        userId: customerUser.id,
        ackDueAt: new Date(now.getTime() - 2 * 3600 * 1000), // 2h overdue
        resolveDueAt: new Date(now.getTime() + 25 * 86400 * 1000),
      },
    });

    // Run 1: should find breach and enqueue outbox row
    const jobResult1 = await runTicketSlaJob();
    expect(jobResult1.ackBreaches).toBeGreaterThanOrEqual(1);

    const outboxAlert = await prisma.eventOutbox.findFirst({
      where: {
        type: "TICKET_SLA_BREACH",
        dedupeKey: `sla-breach-${overdueTicket.id}-ack`,
      },
    });
    expect(outboxAlert).not.toBeNull();

    // Verify slaAlertedAt was set
    const updatedTicket = await prisma.ticket.findUnique({
      where: { id: overdueTicket.id },
    });
    expect(updatedTicket?.slaAlertedAt).not.toBeNull();

    // Run 2: idempotent, does not create duplicate outbox records
    await runTicketSlaJob();
    const count = await prisma.eventOutbox.count({
      where: {
        type: "TICKET_SLA_BREACH",
        dedupeKey: `sla-breach-${overdueTicket.id}-ack`,
      },
    });
    expect(count).toBe(1);
  });
});
