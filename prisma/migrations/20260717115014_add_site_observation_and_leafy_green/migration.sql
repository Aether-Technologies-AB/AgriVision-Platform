-- ============================================================================
-- !! DO NOT REGENERATE THIS FILE FROM prisma/schema.prisma WITHOUT READING !!
--
-- The CREATE UNIQUE INDEX below for SiteObservation includes
-- `NULLS NOT DISTINCT`, hand-added because Prisma's schema DSL (7.5) cannot
-- express it — schema.prisma's @@unique for this model is a plain-UNIQUE
-- stand-in, documented as such at that line. `prisma migrate dev`/diff has
-- no idea NULLS NOT DISTINCT exists here and, if ever run against this model
-- (once the corrupted baseline — 20260712190829_baseline, stray dotenv log
-- on line 1 — is fixed and shadow-DB diffing works again), WILL propose
-- dropping and recreating this index as a plain UNIQUE.
--
-- Doing that WILL SILENTLY BREAK FUSED-ROW IDEMPOTENCY: the FUSED
-- SiteObservation row (viewAngleDeg IS NULL, isFused true) is only deduped
-- on repost because NULLS NOT DISTINCT makes its NULL viewAngleDeg
-- participate in uniqueness. A plain UNIQUE silently inserts a new
-- duplicate fused row on every repost instead — no error, no failed
-- constraint, just quietly wrong data (and the fused rows are the ones
-- carrying the best trait data — 3-view 3D reconstruction).
--
-- src/app/api/observations/route.test.ts guards this: it posts a fused
-- record twice and asserts exactly one row exists. If that test starts
-- failing, re-check this index with:
--   SELECT pg_get_indexdef(indexrelid) FROM pg_index
--   WHERE indrelid = '"SiteObservation"'::regclass;
-- and confirm "NULLS NOT DISTINCT" is still there.
-- ============================================================================

-- AlterEnum
-- Additive only: adds one new value to an existing enum. Does not touch any
-- row currently set to MUSHROOM or MICROGREEN, and does not affect any other
-- column or table. Postgres requires this to run outside the same
-- transaction as any statement that *uses* the new value — nothing below
-- uses it, so this is safe as a standalone migration step.
ALTER TYPE "public"."CropFamily" ADD VALUE 'LEAFY_GREEN';

-- CreateTable
-- New table only. No existing table (Photo, Batch, Zone, or otherwise) is
-- altered, dropped, renamed, or has a column type changed by this migration.
CREATE TABLE "public"."SiteObservation" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "batchId" TEXT,
    "photoId" TEXT,
    "rail" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "globalRow" INTEGER NOT NULL,
    "channel" INTEGER NOT NULL,
    "stop" INTEGER NOT NULL,
    "viewAngleDeg" DOUBLE PRECISION,
    "isFused" BOOLEAN NOT NULL DEFAULT false,
    "isPrimaryView" BOOLEAN NOT NULL,
    "nViewsFused" INTEGER,
    "fusionGainPct" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "plantPresent" BOOLEAN NOT NULL,
    "rejectReason" TEXT,
    "areaPx" INTEGER,
    "areaCm2" DOUBLE PRECISION,
    "canopyVolumeCm3" DOUBLE PRECISION,
    "heightMmMax" DOUBLE PRECISION,
    "heightMmMean" DOUBLE PRECISION,
    "heightProfileMm" JSONB,
    "widthMm" DOUBLE PRECISION,
    "lengthMm" DOUBLE PRECISION,
    "coverage" DOUBLE PRECISION,
    "exgMean" DOUBLE PRECISION,
    "exgStd" DOUBLE PRECISION,
    "labAMean" DOUBLE PRECISION,
    "deepGreenFrac" DOUBLE PRECISION,
    "depthValidPct" DOUBLE PRECISION,
    "clippedByRoi" BOOLEAN,
    "channelPlaneMm" DOUBLE PRECISION,
    "fx" DOUBLE PRECISION,
    "freshWeightGEst" DOUBLE PRECISION,
    "calibrationVersion" TEXT,
    "schemaVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- NULLS NOT DISTINCT (Postgres 15+; this DB is 17.10) makes NULL participate
-- in uniqueness like any other value, so the FUSED row (viewAngleDeg IS
-- NULL, isFused true) is correctly deduped by the DB itself on re-post of a
-- cycle, same as the 3 non-fused rows. This is NOT expressible in Prisma's
-- schema DSL (7.5 rejects `nullsNotDistinct` on @@unique) — the
-- corresponding schema.prisma @@unique is a plain UNIQUE for typing
-- purposes only; this line is the source of truth for actual behavior.
CREATE UNIQUE INDEX "SiteObservation_rail_cycleId_siteId_viewAngleDeg_isFused_key" ON "public"."SiteObservation"("rail", "cycleId", "siteId", "viewAngleDeg", "isFused") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "SiteObservation_siteId_capturedAt_idx" ON "public"."SiteObservation"("siteId", "capturedAt");

-- CreateIndex
CREATE INDEX "SiteObservation_zoneId_capturedAt_idx" ON "public"."SiteObservation"("zoneId", "capturedAt");

-- CreateIndex
CREATE INDEX "SiteObservation_cycleId_idx" ON "public"."SiteObservation"("cycleId");

-- AddForeignKey
ALTER TABLE "public"."SiteObservation" ADD CONSTRAINT "SiteObservation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "public"."Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SiteObservation" ADD CONSTRAINT "SiteObservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SiteObservation" ADD CONSTRAINT "SiteObservation_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "public"."Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
