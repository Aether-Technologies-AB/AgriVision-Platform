-- ============================================================================
-- !! HAND-WRITTEN. DO NOT REGENERATE FROM prisma/schema.prisma !!
--
-- Adds SiteObservation."method" and puts it into the compound unique key, so a
-- cycle can be measured twice — once by the production ExG/ROI gate
-- (method = 'gate') and once by the YOLOv8s-seg lettuce model
-- (method = 'seg-v1') — without either row upserting over the other.
--
-- The index recreated below MUST keep `NULLS NOT DISTINCT`, exactly as the
-- original in 20260717115014_add_site_observation_and_leafy_green. Prisma's
-- schema DSL (7.5) cannot express that keyword, so the @@unique in
-- schema.prisma is a plain-UNIQUE stand-in for typing only, and this file is
-- the source of truth for the actual constraint.
--
-- Dropping it to a plain UNIQUE SILENTLY BREAKS FUSED-ROW IDEMPOTENCY: the
-- FUSED row has viewAngleDeg IS NULL, and only NULLS NOT DISTINCT makes that
-- NULL participate in uniqueness. A plain UNIQUE inserts a fresh duplicate
-- fused row on every repost of a cycle — no error, no failed constraint, just
-- quietly wrong data in precisely the rows carrying the best traits.
--
-- src/app/api/observations/route.test.ts guards this. After applying, confirm:
--   SELECT pg_get_indexdef(indexrelid) FROM pg_index
--   WHERE indrelid = '"SiteObservation"'::regclass;
-- and check "NULLS NOT DISTINCT" is still present on the compound key.
-- ============================================================================

-- AlterTable
-- Defaulted, so every pre-existing row becomes method = 'gate' — which is what
-- they all are. No stored value changes.
ALTER TABLE "public"."SiteObservation"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'gate';

-- DropIndex
-- The old 5-column key. Dropped and recreated rather than altered, because
-- Postgres cannot add a column to an existing unique index in place.
DROP INDEX "public"."SiteObservation_rail_cycleId_siteId_viewAngleDeg_isFused_key";

-- CreateIndex
-- Same clause as before, one column wider. The generated Prisma Client key name
-- for this constraint becomes
--   rail_cycleId_siteId_viewAngleDeg_isFused_method
-- which is what src/app/api/observations/route.ts upserts against.
-- Name is 63 chars: Postgres truncates identifiers there, and the name Prisma
-- would derive for a 6-column key is longer, so it is pinned here and via
-- `map:` on the @@unique in schema.prisma so both agree.
CREATE UNIQUE INDEX "SiteObservation_rail_cycleId_siteId_viewAngleDeg_isFused_method"
  ON "public"."SiteObservation"("rail", "cycleId", "siteId", "viewAngleDeg", "isFused", "method")
  NULLS NOT DISTINCT;

-- CreateIndex
-- Reading one method's series is the common query now that two coexist
-- (e.g. "gate vs seg-v1 for this site over the batch"), and every such read
-- would otherwise fall back to the (siteId, capturedAt) index and filter.
CREATE INDEX "SiteObservation_rail_method_capturedAt_idx"
  ON "public"."SiteObservation"("rail", "method", "capturedAt");
