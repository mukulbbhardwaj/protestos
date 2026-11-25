-- CreateIndex
CREATE INDEX "CadParcel_countyId_taxYear_marketValue_idx" ON "CadParcel"("countyId", "taxYear", "marketValue");
