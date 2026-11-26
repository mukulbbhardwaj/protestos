-- CreateEnum
CREATE TYPE "HearingType" AS ENUM ('INFORMAL', 'ARB', 'ARBITRATION', 'LITIGATION');

-- CreateEnum
CREATE TYPE "HearingStatus" AS ENUM ('SCHEDULED', 'ATTENDED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW');

-- AlterEnum
ALTER TYPE "ImportKind" ADD VALUE 'HEARINGS';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "calendarToken" TEXT;

-- CreateTable
CREATE TABLE "Hearing" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "type" "HearingType" NOT NULL DEFAULT 'ARB',
    "status" "HearingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "location" TEXT,
    "panel" TEXT,
    "notes" TEXT,
    "assignedUserId" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Hearing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Hearing_orgId_scheduledAt_idx" ON "Hearing"("orgId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Hearing_orgId_propertyId_taxYear_idx" ON "Hearing"("orgId", "propertyId", "taxYear");

-- CreateIndex
CREATE INDEX "Hearing_orgId_assignedUserId_scheduledAt_idx" ON "Hearing"("orgId", "assignedUserId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_calendarToken_key" ON "Membership"("calendarToken");

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_orgId_propertyId_fkey" FOREIGN KEY ("orgId", "propertyId") REFERENCES "Property"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Tenant isolation (ADR 003).
ALTER TABLE "Hearing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Hearing"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
