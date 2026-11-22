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
  const alertRecipient =
    settings.grievanceOfficerEmail ||
    settings.supportEmail ||
    process.env.SUPPORT_EMAIL ||
    "alerts@system.local";

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
    let alerted = false;

    // 1. Acknowledgment SLA check
    if (ticket.acknowledgedAt === null && ticket.ackDueAt <= now) {
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
        },
        dedupeKey: ackDedupe,
      });
      ackBreaches++;
      alerted = true;
    }

    // 2. Resolution SLA check (overdue or within 3 days of deadline)
    if (ticket.resolveDueAt <= threeDaysFromNow) {
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
        },
        dedupeKey: resolveDedupe,
      });
      resolveBreaches++;
      alerted = true;
    }

    if (alerted && !ticket.slaAlertedAt) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { slaAlertedAt: now },
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
