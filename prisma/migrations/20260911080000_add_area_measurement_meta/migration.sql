-- Additive only. Preserve the existing method-aware NULLS NOT DISTINCT index.
ALTER TABLE "SiteObservation" ADD COLUMN "measurementMeta" JSONB;
