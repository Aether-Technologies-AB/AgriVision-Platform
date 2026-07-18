-- Add plantCount to Batch: the production unit for individually-spaced,
-- countable crops (basil, lettuce / LEAFY_GREEN). Distinct from
-- seedingDensityGSqm, which models a seeded microgreen mat by weight.
-- Additive, nullable, no backfill — existing rows get NULL.
ALTER TABLE "Batch" ADD COLUMN "plantCount" INTEGER;
