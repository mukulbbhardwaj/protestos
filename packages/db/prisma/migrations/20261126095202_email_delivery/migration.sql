-- CreateEnum
CREATE TYPE "EmailTemplateKey" AS ENUM ('INVOICE', 'INVOICE_ZERO_SAVINGS', 'PAYMENT_RECEIPT', 'DOC_REMINDER', 'PROSPECT_OUTREACH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'BOUNCED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "key" "EmailTemplateKey" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "templateKey" "EmailTemplateKey" NOT NULL,
    "contactId" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "paymentId" INTEGER,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "events" JSONB NOT NULL DEFAULT '[]',
    "attachmentKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" INTEGER,
    "queuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(6),
    "lastEventAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_orgId_key_key" ON "EmailTemplate"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_providerMessageId_key" ON "EmailDelivery"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailDelivery_orgId_invoiceId_idx" ON "EmailDelivery"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "EmailDelivery_orgId_status_idx" ON "EmailDelivery"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_orgId_idempotencyKey_key" ON "EmailDelivery"("orgId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_orgId_contactId_fkey" FOREIGN KEY ("orgId", "contactId") REFERENCES "Contact"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_orgId_invoiceId_fkey" FOREIGN KEY ("orgId", "invoiceId") REFERENCES "Invoice"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_orgId_paymentId_fkey" FOREIGN KEY ("orgId", "paymentId") REFERENCES "Payment"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation (ADR 003).
ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailTemplate"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "EmailDelivery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailDelivery"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
