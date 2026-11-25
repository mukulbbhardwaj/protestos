-- CreateEnum
CREATE TYPE "TaxUnitKind" AS ENUM ('SCHOOL', 'COUNTY', 'CITY', 'OTHER');

-- CreateTable
CREATE TABLE "CadParcel" (
    "id" SERIAL NOT NULL,
    "countyId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "stateClass" TEXT NOT NULL,
    "neighborhoodCode" TEXT NOT NULL,
    "ownerName" TEXT,
    "situsLine" TEXT,
    "situsZip" TEXT,
    "landValue" DECIMAL(15,2) NOT NULL,
    "improvementValue" DECIMAL(15,2) NOT NULL,
    "marketValue" DECIMAL(15,2) NOT NULL,
    "appraisedValue" DECIMAL(15,2) NOT NULL,
    "livingAreaSqft" INTEGER,
    "yearBuilt" INTEGER,
    "qualityCode" TEXT,
    "homestead" BOOLEAN NOT NULL DEFAULT false,
    "taxCeiling" BOOLEAN NOT NULL DEFAULT false,
    "units" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "CadParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadTaxUnit" (
    "id" SERIAL NOT NULL,
    "countyId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TaxUnitKind" NOT NULL DEFAULT 'OTHER',
    "ratePct" DECIMAL(9,6),

    CONSTRAINT "CadTaxUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadLoad" (
    "id" SERIAL NOT NULL,
    "countyId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "parcelCount" INTEGER NOT NULL,
    "loadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadLoad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CadParcel_countyId_taxYear_neighborhoodCode_stateClass_livi_idx" ON "CadParcel"("countyId", "taxYear", "neighborhoodCode", "stateClass", "livingAreaSqft");

-- CreateIndex
CREATE UNIQUE INDEX "CadParcel_countyId_taxYear_accountNumber_key" ON "CadParcel"("countyId", "taxYear", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CadTaxUnit_countyId_taxYear_code_key" ON "CadTaxUnit"("countyId", "taxYear", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CadLoad_countyId_taxYear_key" ON "CadLoad"("countyId", "taxYear");

-- AddForeignKey
ALTER TABLE "CadParcel" ADD CONSTRAINT "CadParcel_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadTaxUnit" ADD CONSTRAINT "CadTaxUnit_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadLoad" ADD CONSTRAINT "CadLoad_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CAD roll tables are shared public reference data (like County): readable by every firm,
-- written only by the backfill (`pnpm db:backfill cad`), never by tenant code.
REVOKE INSERT, UPDATE, DELETE ON "CadParcel", "CadTaxUnit", "CadLoad" FROM app_tenant;

-- Calculator search by address and owner.
CREATE INDEX "CadParcel_situsLine_trgm" ON "CadParcel" USING gin ("situsLine" gin_trgm_ops);
CREATE INDEX "CadParcel_ownerName_trgm" ON "CadParcel" USING gin ("ownerName" gin_trgm_ops);
