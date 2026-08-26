-- Add refill-reservoir level to SensorReading (ultrasonic sensor, pi4-003 GGS
-- Climate zone). The main reservoir is held constant by a float valve; the
-- sensor is in the refill tank feeding it, so this volume falls as the crop
-- draws water and jumps up on manual refills — the slope is transpiration.
-- Additive, nullable, no backfill — existing rows get NULL, every non-sensor
-- zone is unaffected.
ALTER TABLE "SensorReading" ADD COLUMN "waterLevelL" DOUBLE PRECISION;
ALTER TABLE "SensorReading" ADD COLUMN "waterLevelMm" DOUBLE PRECISION;
