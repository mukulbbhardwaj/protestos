-- CreateEnum
CREATE TYPE "SavingsBasis" AS ENUM ('APPRAISED', 'MARKET');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('PROSPECT', 'CLIENT');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('NEW', 'CONTACTED', 'DOCS_SENT', 'SIGNED', 'LOST');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('WEB_FORM', 'MANUAL', 'IMPORT', 'REFERRAL');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'BPP', 'LAND', 'OTHER');

-- CreateEnum
CREATE TYPE "ProtestStage" AS ENUM ('NOT_STARTED', 'AOA_SIGNED', 'NOTICE_RECEIVED', 'PROTEST_FILED', 'HEARING_SCHEDULED', 'SETTLED', 'BOARD_ORDER', 'NO_CHANGE', 'WITHDRAWN', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('SETTLEMENT', 'BOARD_ORDER', 'NO_CHANGE', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "flatFeeCurrentYearOnly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nextClientNumber" INTEGER NOT NULL DEFAULT 1001,
ADD COLUMN     "savingsBasis" "SavingsBasis" NOT NULL DEFAULT 'APPRAISED';

-- CreateTable
CREATE TABLE "County" (
    "id" SERIAL NOT NULL,
    "state" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "cadName" TEXT NOT NULL,
    "cadWebsite" TEXT,

    CONSTRAINT "County_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "status" "ProspectStatus",
    "clientNumber" TEXT,
    "displayName" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL DEFAULT 'INDIVIDUAL',
    "email" TEXT,
    "billingEmail" TEXT,
    "phone" TEXT,
    "mailingAddress" JSONB,
    "billingAddress" JSONB,
    "nameOnCad" TEXT,
    "contingencyPct" DECIMAL(9,4),
    "flatFee" DECIMAL(15,2),
    "bppFee" DECIMAL(15,2),
    "source" "ContactSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "convertedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "countyId" INTEGER NOT NULL,
    "situsAddress" JSONB,
    "situsLine" TEXT,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'RESIDENTIAL',
    "consultantUserId" INTEGER,
    "contingencyPct" DECIMAL(9,4),
    "flatFee" DECIMAL(15,2),
    "bppFee" DECIMAL(15,2),
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(6),
    "archivedWithContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxYearRecord" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "noticeLand" DECIMAL(15,2),
    "noticeImprovement" DECIMAL(15,2),
    "noticeMarket" DECIMAL(15,2),
    "noticeAppraised" DECIMAL(15,2),
    "finalLand" DECIMAL(15,2),
    "finalImprovement" DECIMAL(15,2),
    "finalMarket" DECIMAL(15,2),
    "finalAppraised" DECIMAL(15,2),
    "taxRatePct" DECIMAL(9,4),
    "bppRenderedAt" DATE,
    "bppFee" DECIMAL(15,2),
    "underLitigation" BOOLEAN NOT NULL DEFAULT false,
    "underArbitration" BOOLEAN NOT NULL DEFAULT false,
    "homestead" BOOLEAN NOT NULL DEFAULT false,
    "protestStage" "ProtestStage" NOT NULL DEFAULT 'NOT_STARTED',
    "noticeReceivedAt" DATE,
    "protestFiledAt" DATE,
    "resultType" "ResultType",
    "resultAt" DATE,
    "contingencyPctOverride" DECIMAL(9,4),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TaxYearRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtestStageEvent" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "taxYearRecordId" INTEGER NOT NULL,
    "fromStage" "ProtestStage",
    "toStage" "ProtestStage" NOT NULL,
    "note" TEXT,
    "actorUserId" INTEGER,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProtestStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "County_state_name_key" ON "County"("state", "name");

-- CreateIndex
CREATE INDEX "Contact_orgId_kind_archivedAt_idx" ON "Contact"("orgId", "kind", "archivedAt");

-- CreateIndex
CREATE INDEX "Contact_orgId_status_idx" ON "Contact"("orgId", "status");

-- CreateIndex
CREATE INDEX "Contact_orgId_createdAt_idx" ON "Contact"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_orgId_id_key" ON "Contact"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_orgId_clientNumber_key" ON "Contact"("orgId", "clientNumber");

-- CreateIndex
CREATE INDEX "Property_orgId_contactId_idx" ON "Property"("orgId", "contactId");

-- CreateIndex
CREATE INDEX "Property_orgId_consultantUserId_idx" ON "Property"("orgId", "consultantUserId");

-- CreateIndex
CREATE INDEX "Property_orgId_archivedAt_idx" ON "Property"("orgId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Property_orgId_id_key" ON "Property"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Property_orgId_countyId_accountNumber_key" ON "Property"("orgId", "countyId", "accountNumber");

-- CreateIndex
CREATE INDEX "TaxYearRecord_orgId_taxYear_protestStage_idx" ON "TaxYearRecord"("orgId", "taxYear", "protestStage");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYearRecord_orgId_id_key" ON "TaxYearRecord"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYearRecord_propertyId_taxYear_key" ON "TaxYearRecord"("propertyId", "taxYear");

-- CreateIndex
CREATE INDEX "ProtestStageEvent_orgId_taxYearRecordId_at_idx" ON "ProtestStageEvent"("orgId", "taxYearRecordId", "at");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_orgId_contactId_fkey" FOREIGN KEY ("orgId", "contactId") REFERENCES "Contact"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_consultantUserId_fkey" FOREIGN KEY ("consultantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYearRecord" ADD CONSTRAINT "TaxYearRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYearRecord" ADD CONSTRAINT "TaxYearRecord_orgId_propertyId_fkey" FOREIGN KEY ("orgId", "propertyId") REFERENCES "Property"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestStageEvent" ADD CONSTRAINT "ProtestStageEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestStageEvent" ADD CONSTRAINT "ProtestStageEvent_orgId_taxYearRecordId_fkey" FOREIGN KEY ("orgId", "taxYearRecordId") REFERENCES "TaxYearRecord"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestStageEvent" ADD CONSTRAINT "ProtestStageEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Same-org integrity is enforced by the composite foreign keys above.

-- Tenant isolation (ADR 003). New tables inherit app_tenant grants from default privileges.
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Contact"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "Property" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Property"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "TaxYearRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaxYearRecord"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "ProtestStageEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProtestStageEvent"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
-- Stage history is append-only.
REVOKE UPDATE, DELETE ON "ProtestStageEvent" FROM app_tenant;

-- County is shared reference data: readable by everyone, written only by migrations.
REVOKE INSERT, UPDATE, DELETE ON "County" FROM app_tenant;

-- Trigram indexes for global search (BUILD_PLAN 8.12). They serve ILIKE '%term%', which is what
-- Prisma `contains` with `mode: insensitive` generates.
CREATE INDEX "Contact_displayName_trgm" ON "Contact" USING gin ("displayName" gin_trgm_ops);
CREATE INDEX "Contact_email_trgm" ON "Contact" USING gin ("email" gin_trgm_ops);
CREATE INDEX "Contact_clientNumber_trgm" ON "Contact" USING gin ("clientNumber" gin_trgm_ops);
CREATE INDEX "Contact_phone_trgm" ON "Contact" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "Property_accountNumber_trgm" ON "Property" USING gin ("accountNumber" gin_trgm_ops);
CREATE INDEX "Property_situsLine_trgm" ON "Property" USING gin ("situsLine" gin_trgm_ops);

-- County rows are reference data loaded by `pnpm db:backfill counties` (packages/db/scripts),
-- not by this migration.
