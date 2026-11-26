-- CreateEnum
CREATE TYPE "InvoiceGrouping" AS ENUM ('CLIENT_YEAR', 'PROPERTY_YEAR');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "InvoiceTemplate" AS ENUM ('STANDARD', 'ARBITRATION', 'HOMESTEAD', 'ZERO_SAVINGS');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('CONTINGENCY', 'FLAT', 'BPP', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ZELLE', 'CHECK', 'ACH', 'CASH', 'CARD', 'OTHER');

-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "invoiceGrouping" "InvoiceGrouping" NOT NULL DEFAULT 'CLIENT_YEAR',
ADD COLUMN     "paymentInstructions" TEXT;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "number" TEXT,
    "taxYear" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE,
    "dueDate" DATE,
    "template" "InvoiceTemplate" NOT NULL DEFAULT 'STANDARD',
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "pdfKey" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" TEXT,
    "writtenOffAt" TIMESTAMPTZ(6),
    "writeOffReason" TEXT,
    "notes" TEXT,
    "historical" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "propertyId" INTEGER,
    "taxYearRecordId" INTEGER,
    "kind" "InvoiceLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "snapshot" JSONB,
    "amount" DECIMAL(15,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "receivedAt" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_orgId_status_dueDate_idx" ON "Invoice"("orgId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_orgId_contactId_idx" ON "Invoice"("orgId", "contactId");

-- CreateIndex
CREATE INDEX "Invoice_orgId_taxYear_idx" ON "Invoice"("orgId", "taxYear");

-- CreateIndex
CREATE INDEX "Invoice_orgId_issueDate_idx" ON "Invoice"("orgId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_id_key" ON "Invoice"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_number_key" ON "Invoice"("orgId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_orgId_invoiceId_idx" ON "InvoiceLine"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_orgId_taxYearRecordId_idx" ON "InvoiceLine"("orgId", "taxYearRecordId");

-- CreateIndex
CREATE INDEX "Payment_orgId_contactId_idx" ON "Payment"("orgId", "contactId");

-- CreateIndex
CREATE INDEX "Payment_orgId_receivedAt_idx" ON "Payment"("orgId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orgId_id_key" ON "Payment"("orgId", "id");

-- CreateIndex
CREATE INDEX "PaymentAllocation_orgId_invoiceId_idx" ON "PaymentAllocation"("orgId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orgId_contactId_fkey" FOREIGN KEY ("orgId", "contactId") REFERENCES "Contact"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orgId_invoiceId_fkey" FOREIGN KEY ("orgId", "invoiceId") REFERENCES "Invoice"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orgId_propertyId_fkey" FOREIGN KEY ("orgId", "propertyId") REFERENCES "Property"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orgId_taxYearRecordId_fkey" FOREIGN KEY ("orgId", "taxYearRecordId") REFERENCES "TaxYearRecord"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orgId_contactId_fkey" FOREIGN KEY ("orgId", "contactId") REFERENCES "Contact"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orgId_paymentId_fkey" FOREIGN KEY ("orgId", "paymentId") REFERENCES "Payment"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orgId_invoiceId_fkey" FOREIGN KEY ("orgId", "invoiceId") REFERENCES "Invoice"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (ADR 003).
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceLine"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentAllocation"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
