-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CONTACTS_PROPERTIES', 'TAX_YEAR_VALUES', 'HISTORICAL_INVOICES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportAction" AS ENUM ('CREATE', 'UPDATE', 'UNCHANGED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportPhase" AS ENUM ('PREVIEW', 'APPLY');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "headers" TEXT[],
    "columnMapping" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB,
    "error" TEXT,
    "createdById" INTEGER,
    "previewedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "importJobId" INTEGER NOT NULL,
    "phase" "ImportPhase" NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "action" "ImportAction" NOT NULL,
    "label" TEXT,
    "changes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_orgId_createdAt_idx" ON "ImportJob"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_orgId_id_key" ON "ImportJob"("orgId", "id");

-- CreateIndex
CREATE INDEX "ImportRow_orgId_importJobId_phase_rowNumber_idx" ON "ImportRow"("orgId", "importJobId", "phase", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportRow_orgId_importJobId_phase_action_idx" ON "ImportRow"("orgId", "importJobId", "phase", "action");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_orgId_importJobId_fkey" FOREIGN KEY ("orgId", "importJobId") REFERENCES "ImportJob"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation (ADR 003).
ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportJob"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "ImportRow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportRow"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
