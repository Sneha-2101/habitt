import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { enqueueOutbox } from "@/lib/outbox/enqueue";

export interface SlaJobResult {
  checked: number;
  ackBreaches: number;
  resolveBreaches: number;
  itemsProcessed: number;
}

/**
 * Runs the periodic SLA check job.
 * Scans for:
 * 1. Unacknowledged tickets past ackDueAt.
 * 2. Unresolved tickets past resolveDueAt (or within 3 days of resolveDueAt).
 *
 * Enqueues outbox alerts idempotently using dedupeKey.
 */
export async function runTicketSlaJob(): Promise<SlaJobResult> {
  const settings = await getSettings();
  const defaultRecipient =
    settings.supportEmail ||
    process.env.SUPPORT_EMAIL ||
    "support@local.test";
  const grievanceRecipient =
    settings.grievanceOfficerEmail ||
    defaultRecipient;

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  // Active tickets that could be in breach
  const activeStatuses = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] as const;

  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: [...activeStatuses] },
    },
  });

  let ackBreaches = 0;
  let resolveBreaches = 0;

  for (const ticket of tickets) {
    const isGrievance = ticket.category === "GRIEVANCE";
    const alertRecipient = isGrievance ? grievanceRecipient : defaultRecipient;

    const updateData: { ackAlertedAt?: Date; resolveAlertedAt?: Date; slaAlertedAt?: Date } = {};

    // 1. Acknowledgment SLA check (only if not acknowledged and not already alerted for ack)
    if (ticket.acknowledgedAt === null && ticket.ackDueAt <= now && ticket.ackAlertedAt === null) {
      const ackDedupe = `sla-breach-${ticket.id}-ack`;
      await enqueueOutbox({
        type: "TICKET_SLA_BREACH",
        channel: "EMAIL",
        orderId: ticket.orderId || null,
        payload: {
          recipientEmail: alertRecipient,
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          subject: `[SLA Alert] Ticket #${ticket.number} pending acknowledgement`,
          alertType: "ACK_BREACH",
          ackDueAt: ticket.ackDueAt.toISOString(),
          category: ticket.category,
        },
        dedupeKey: ackDedupe,
      });
      ackBreaches++;
      updateData.ackAlertedAt = now;
      updateData.slaAlertedAt = now;
    }

    // 2. Resolution SLA check (overdue or within 3 days of deadline, only if not already alerted for resolve)
    if (ticket.resolveDueAt <= threeDaysFromNow && ticket.resolveAlertedAt === null) {
      const resolveDedupe = `sla-breach-${ticket.id}-resolve`;
      await enqueueOutbox({
        type: "TICKET_SLA_BREACH",
        channel: "EMAIL",
        orderId: ticket.orderId || null,
        payload: {
          recipientEmail: alertRecipient,
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          subject: `[SLA Alert] Ticket #${ticket.number} resolution deadline warning/breach`,
          alertType: "RESOLVE_BREACH",
          resolveDueAt: ticket.resolveDueAt.toISOString(),
          category: ticket.category,
        },
        dedupeKey: resolveDedupe,
      });
      resolveBreaches++;
      updateData.resolveAlertedAt = now;
      updateData.slaAlertedAt = now;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: updateData,
      });
    }
  }

  const itemsProcessed = ackBreaches + resolveBreaches;
  return {
    checked: tickets.length,
    ackBreaches,
    resolveBreaches,
    itemsProcessed,
  };
}
