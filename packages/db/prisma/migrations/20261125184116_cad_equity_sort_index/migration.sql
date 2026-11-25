-- DropIndex
DROP INDEX "CadParcel_countyId_taxYear_stateClass_equityIndex_idx";

-- CreateIndex
CREATE INDEX "CadParcel_countyId_taxYear_equityIndex_idx" ON "CadParcel"("countyId", "taxYear", "equityIndex");
