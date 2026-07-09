/**
 * Post-backfill verification for PR 1. Reads live data and asserts the
 * invariants the PR promised. Run:
 *
 *   npx tsx scripts/verify_pr1_backfill.ts
 *
 * Exits non-zero on any failed check.
 *
 * Covers:
 *   (b) B-2026-014 was correctly reclassified: cropFamily=MICROGREEN,
 *       cropType="Sakura", phase=GERMINATION, trayCount=4.
 *   Plus the broader invariants the same backfill guarantees:
 *     - Every batch has a non-null cropFamily.
 *     - Every microgreens batch's phase is legal for MICROGREEN.
 *     - Every mushroom batch's phase is legal for MUSHROOM.
 *     - Urban Seeds Rack has defaultCropFamily=MICROGREEN.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient, CropFamily, BatchPhase } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isPhaseValidForFamily } from "@/lib/crop-family";
import assert from "node:assert/strict";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const URBAN_SEEDS_RACK_ZONE_ID = "cmomks3yh000ags9ky6t2z0hj";
const B_2026_014_ID = "cmrda6m12000z04jxb3rsfcz9";

async function main() {
  let checks = 0;

  const b14 = await prisma.batch.findUnique({ where: { id: B_2026_014_ID } });
  assert.ok(b14, "B-2026-014 must exist");
  assert.equal(b14!.cropFamily, CropFamily.MICROGREEN, "B-2026-014 cropFamily");
  assert.equal(b14!.cropType, "Sakura", "B-2026-014 cropType preserved");
  assert.equal(b14!.phase, BatchPhase.GERMINATION, "B-2026-014 phase remap");
  assert.equal(b14!.trayCount, 4, "B-2026-014 trayCount");
  checks += 4;
  console.log("✔ B-2026-014 reclassified: MICROGREEN / Sakura / GERMINATION / 4 trays");

  const zone = await prisma.zone.findUnique({
    where: { id: URBAN_SEEDS_RACK_ZONE_ID },
  });
  assert.equal(zone?.defaultCropFamily, CropFamily.MICROGREEN, "Urban Seeds Rack default family");
  checks += 1;
  console.log("✔ Urban Seeds Rack defaultCropFamily=MICROGREEN");

  const orphaned = await prisma.batch.count({ where: { cropFamily: null } });
  assert.equal(orphaned, 0, "Every batch must have a non-null cropFamily after backfill");
  checks += 1;
  console.log("✔ No batches with null cropFamily");

  const allBatches = await prisma.batch.findMany({
    select: { id: true, batchNumber: true, cropFamily: true, phase: true },
  });
  for (const b of allBatches) {
    assert.ok(b.cropFamily, `${b.batchNumber} has cropFamily`);
    assert.ok(
      isPhaseValidForFamily(b.cropFamily!, b.phase),
      `${b.batchNumber}: phase ${b.phase} illegal for family ${b.cropFamily}`
    );
  }
  checks += allBatches.length;
  console.log(`✔ All ${allBatches.length} batches have legal (family, phase) pairs`);

  console.log(`\nPASS — ${checks} assertions checked.`);
}

main()
  .catch((e) => {
    console.error("FAIL:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
