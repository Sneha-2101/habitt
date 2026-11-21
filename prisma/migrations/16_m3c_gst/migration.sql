-- CreateEnum
CREATE TYPE "GstFeeMode" AS ENUM ('COMPOSITE', 'SEPARATE');

-- CreateEnum
CREATE TYPE "InvoiceMode" AS ENUM ('TAX', 'RECEIPT');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('GOODS', 'SHIPPING', 'COD');

-- AlterTable SiteSettings
ALTER TABLE "SiteSettings" ADD COLUMN "gstFeeMode" "GstFeeMode" NOT NULL DEFAULT 'COMPOSITE',
ADD COLUMN "gstFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 18.0,
ADD COLUMN "invoicePrefix" TEXT NOT NULL DEFAULT 'HB';

ALTER TABLE "SiteSettings" ALTER COLUMN "businessState" SET DEFAULT 'Kerala';
UPDATE "SiteSettings" SET "businessState" = 'Kerala' WHERE "businessState" IS NULL;

-- CreateTable GstRule
CREATE TABLE "GstRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsn" TEXT,
    "categoryId" TEXT,
    "minUnitPaise" INTEGER NOT NULL DEFAULT 0,
    "maxUnitPaise" INTEGER,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GstRule_ratePercent_check" CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100),
    CONSTRAINT "GstRule_minUnitPaise_check" CHECK ("minUnitPaise" >= 0)
);

-- CreateTable InvoiceCounter
CREATE TABLE "InvoiceCounter" (
    "fy" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("fy")
);

-- CreateTable Invoice
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mode" "InvoiceMode" NOT NULL DEFAULT 'TAX',
    "fy" TEXT,
    "number" TEXT,
    "prefix" TEXT,
    "sequence" INTEGER,
    "sellerGstin" TEXT,
    "sellerName" TEXT NOT NULL,
    "sellerAddress" JSONB NOT NULL,
    "sellerState" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerGstin" TEXT,
    "buyerAddress" JSONB NOT NULL,
    "buyerState" TEXT,
    "placeOfSupply" TEXT,
    "totalPaise" INTEGER NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invoice_totalPaise_check" CHECK ("totalPaise" >= 0)
);

-- CreateTable InvoiceLine
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "kind" "InvoiceLineKind" NOT NULL DEFAULT 'GOODS',
    "description" TEXT NOT NULL,
    "hsn" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable CreditNote
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refundRef" TEXT,
    "totalPaise" INTEGER NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreditNote_totalPaise_check" CHECK ("totalPaise" >= 0)
);

-- CreateTable CreditNoteLine
CREATE TABLE "CreditNoteLine" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceLineId" TEXT,
    "kind" "InvoiceLineKind" NOT NULL DEFAULT 'GOODS',
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,

    CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GstRule_active_idx" ON "GstRule"("active");
CREATE INDEX "GstRule_hsn_idx" ON "GstRule"("hsn");
CREATE INDEX "GstRule_categoryId_idx" ON "GstRule"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number") WHERE "number" IS NOT NULL;
CREATE INDEX "Invoice_mode_idx" ON "Invoice"("mode");
CREATE INDEX "Invoice_fy_idx" ON "Invoice"("fy");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
CREATE INDEX "InvoiceLine_orderItemId_idx" ON "InvoiceLine"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");
CREATE INDEX "CreditNote_orderId_idx" ON "CreditNote"("orderId");
CREATE INDEX "CreditNote_fy_idx" ON "CreditNote"("fy");

-- CreateIndex
CREATE INDEX "CreditNoteLine_creditNoteId_idx" ON "CreditNoteLine"("creditNoteId");
CREATE INDEX "CreditNoteLine_invoiceLineId_idx" ON "CreditNoteLine"("invoiceLineId");

-- AddForeignKey
ALTER TABLE "GstRule" ADD CONSTRAINT "GstRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
