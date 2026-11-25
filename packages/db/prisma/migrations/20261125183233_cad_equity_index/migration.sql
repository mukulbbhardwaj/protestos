-- AlterTable
ALTER TABLE "CadParcel" ADD COLUMN     "equityIndex" DECIMAL(9,4);

-- CreateIndex
CREATE INDEX "CadParcel_countyId_taxYear_stateClass_equityIndex_idx" ON "CadParcel"("countyId", "taxYear", "stateClass", "equityIndex");
