-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ENGAGEMENT_CONTRACT', 'AOA_50_162');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOIDED');

-- AlterEnum
ALTER TYPE "EmailTemplateKey" ADD VALUE 'DOC_REQUEST';

-- AlterTable
ALTER TABLE "EmailDelivery" ADD COLUMN     "envelopeId" INTEGER;

-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "agentLicense" TEXT,
ADD COLUMN     "agentName" TEXT,
ADD COLUMN     "agentTitle" TEXT,
ADD COLUMN     "allowResendSigned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEnvelope" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "signToken" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SENT',
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "createdById" INTEGER,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "envelopeId" INTEGER,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "taxYear" INTEGER,
    "templateVersion" INTEGER,
    "unsignedKey" TEXT NOT NULL,
    "signedKey" TEXT,
    "signedOffline" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMPTZ(6),
    "createdById" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentProperty" (
    "orgId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "propertyId" INTEGER NOT NULL,

    CONSTRAINT "DocumentProperty_pkey" PRIMARY KEY ("documentId","propertyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_orgId_kind_key" ON "DocumentTemplate"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_providerRef_key" ON "SignatureEnvelope"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_signToken_key" ON "SignatureEnvelope"("signToken");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_orgId_contactId_idx" ON "SignatureEnvelope"("orgId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_orgId_id_key" ON "SignatureEnvelope"("orgId", "id");

-- CreateIndex
CREATE INDEX "Document_orgId_contactId_idx" ON "Document"("orgId", "contactId");

-- CreateIndex
CREATE INDEX "Document_orgId_status_idx" ON "Document"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_orgId_id_key" ON "Document"("orgId", "id");

-- CreateIndex
CREATE INDEX "DocumentProperty_orgId_propertyId_idx" ON "DocumentProperty"("orgId", "propertyId");

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_orgId_envelopeId_fkey" FOREIGN KEY ("orgId", "envelopeId") REFERENCES "SignatureEnvelope"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_orgId_contactId_fkey" FOREIGN KEY ("orgId", "contactId") REFERENCES "Contact"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orgId_contactId_fkey" FOREIGN KEY ("orgId", "contactId") REFERENCES "Contact"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orgId_envelopeId_fkey" FOREIGN KEY ("orgId", "envelopeId") REFERENCES "SignatureEnvelope"("orgId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProperty" ADD CONSTRAINT "DocumentProperty_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProperty" ADD CONSTRAINT "DocumentProperty_orgId_documentId_fkey" FOREIGN KEY ("orgId", "documentId") REFERENCES "Document"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProperty" ADD CONSTRAINT "DocumentProperty_orgId_propertyId_fkey" FOREIGN KEY ("orgId", "propertyId") REFERENCES "Property"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation (ADR 003).
ALTER TABLE "DocumentTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentTemplate"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "SignatureEnvelope" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SignatureEnvelope"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
ALTER TABLE "DocumentProperty" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentProperty"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
