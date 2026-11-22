-- Migration 22: M4c Support Tickets & Grievance Officer

-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START WITH 1;

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ORDER', 'PAYMENT', 'RETURN_REFUND', 'PRODUCT', 'ACCOUNT', 'GRIEVANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('ACCOUNT', 'GUEST_FORM', 'ADMIN');

-- CreateEnum
CREATE TYPE "TicketAuthor" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- AlterTable SiteSettings
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "grievanceOfficerName" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "grievanceOfficerEmail" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "grievanceOfficerPhone" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "grievanceOfficerAddress" TEXT;

-- CreateTable Ticket
CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT,
    "guestEmail" TEXT,
    "guestName" TEXT,
    "guestVerifiedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "orderRef" TEXT,
    "category" "TicketCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "source" "TicketSource" NOT NULL,
    "assignedToId" TEXT,
    "accessTokenHash" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "ackDueAt" TIMESTAMP(3) NOT NULL,
    "resolveDueAt" TIMESTAMP(3) NOT NULL,
    "slaAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Ticket_creator_check" CHECK (
        ("userId" IS NOT NULL) OR ("guestEmail" IS NOT NULL AND "guestVerifiedAt" IS NOT NULL)
    )
);

-- CreateTable TicketMessage
CREATE TABLE IF NOT EXISTS "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "TicketAuthor" NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TicketMessage_body_length_check" CHECK (
        char_length("body") >= 1 AND char_length("body") <= 5000
    )
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_number_key" ON "Ticket"("number");
CREATE INDEX IF NOT EXISTS "Ticket_status_resolveDueAt_idx" ON "Ticket"("status", "resolveDueAt");
CREATE INDEX IF NOT EXISTS "Ticket_userId_idx" ON "Ticket"("userId");
CREATE INDEX IF NOT EXISTS "Ticket_guestEmail_idx" ON "Ticket"("guestEmail");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
