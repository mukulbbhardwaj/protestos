-- AlterTable
ALTER TABLE "CadParcel" ADD COLUMN     "marketArea" TEXT,
ADD COLUMN     "propertyUse" TEXT;

-- CreateIndex
CREATE INDEX "CadParcel_countyId_taxYear_marketArea_stateClass_propertyUs_idx" ON "CadParcel"("countyId", "taxYear", "marketArea", "stateClass", "propertyUse");
