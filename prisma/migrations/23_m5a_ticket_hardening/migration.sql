-- Migration 23: M5a Ticket Hardening & Dual SLA Alerts

-- Pre-check guard: fail loudly if existing rows violate CHECK constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Ticket"
    WHERE NOT ("userId" IS NOT NULL OR ("guestEmail" IS NOT NULL AND "guestVerifiedAt" IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Existing Ticket rows violate creator CHECK constraint';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "TicketMessage"
    WHERE NOT (char_length("body") BETWEEN 1 AND 5000)
  ) THEN
    RAISE EXCEPTION 'Existing TicketMessage rows violate body length CHECK constraint';
  END IF;
END $$;

-- Ensure CHECK constraints exist on Ticket and TicketMessage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_creator_check'
  ) THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_creator_check"
      CHECK ("userId" IS NOT NULL OR ("guestEmail" IS NOT NULL AND "guestVerifiedAt" IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketMessage_body_length_check'
  ) THEN
    ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_body_length_check"
      CHECK (char_length("body") BETWEEN 1 AND 5000);
  END IF;
END $$;

-- Dual SLA alert tracking columns
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ackAlertedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "resolveAlertedAt" TIMESTAMP(3);

-- Backfill from single slaAlertedAt
UPDATE "Ticket"
SET
  "ackAlertedAt" = CASE WHEN "acknowledgedAt" IS NULL THEN "slaAlertedAt" ELSE "ackAlertedAt" END,
  "resolveAlertedAt" = CASE WHEN "acknowledgedAt" IS NOT NULL THEN "slaAlertedAt" ELSE "resolveAlertedAt" END
WHERE "slaAlertedAt" IS NOT NULL
  AND "ackAlertedAt" IS NULL
  AND "resolveAlertedAt" IS NULL;

-- Indexes for SLA query performance
CREATE INDEX IF NOT EXISTS "Ticket_ackAlertedAt_idx" ON "Ticket"("ackAlertedAt");
CREATE INDEX IF NOT EXISTS "Ticket_resolveAlertedAt_idx" ON "Ticket"("resolveAlertedAt");
