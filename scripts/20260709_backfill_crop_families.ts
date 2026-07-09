/**
 * Backfill Batch.cropFamily + Zone.defaultCropFamily + fix the one
 * mis-classified microgreens batch (B-2026-014, "Sakura", COLONIZATION).
 *
 * Rules (per PR-1 design):
 *   - Zone `cmomks3yh000ags9ky6t2z0hj` (Urban Seeds Rack) is a microgreens
 *     zone. Every existing Batch in it → cropFamily=MICROGREEN,
 *     trayCount=4 (rack has 4 physical trays; user-confirmed).
 *   - All other zones' batches → cropFamily=MUSHROOM.
 *   - Zone.defaultCropFamily: MICROGREEN on Urban Seeds Rack; MUSHROOM on the
 *     Mushu Stockholm zones. Leave Stockholm Studio Farm's zones null (no
 *     confirmed usage yet — will be set explicitly when they onboard).
 *   - B-2026-014 (cmrda6m12000z04jxb3rsfcz9): was mis-created via the New
 *     Batch form as cropType="Sakura", phase=COLONIZATION. Under MICROGREEN
 *     that phase is illegal → move it to GERMINATION (microgreens Phase 1).
 *
 * NOT done here (intentional):
 *   - trayCount is NOT inferred from bagCount. Only set for URBAN_SEEDS_RACK
 *     batches, and only to the physical rack tray count (4).
 *   - No DB CHECK constraint yet — that lands in PR 3.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/20260709_backfill_crop_families.ts --dry
 *   npx tsx scripts/20260709_backfill_crop_families.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient, CropFamily, BatchPhase } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DRY = process.argv.includes("--dry");

const URBAN_SEEDS_RACK_ZONE_ID = "cmomks3yh000ags9ky6t2z0hj";
const URBAN_SEEDS_TRAY_COUNT = 4;
const MISCLASSIFIED_BATCH_ID = "cmrda6m12000z04jxb3rsfcz9"; // B-2026-014, "Sakura"

async function main() {
  const zones = await prisma.zone.findMany({
    include: { farm: { select: { name: true } } },
  });
  const batches = await prisma.batch.findMany({
    select: {
      id: true,
      batchNumber: true,
      zoneId: true,
      cropType: true,
      cropFamily: true,
      phase: true,
      trayCount: true,
    },
  });

  console.log(`Found ${zones.length} zones, ${batches.length} batches.`);

  // Plan zone default families.
  const zonePlan: {
    zoneId: string;
    name: string;
    farmName: string;
    current: CropFamily | null;
    next: CropFamily | null;
  }[] = zones.map((z) => {
    let next: CropFamily | null = z.defaultCropFamily;
    if (z.id === URBAN_SEEDS_RACK_ZONE_ID) next = CropFamily.MICROGREEN;
    else if (z.farm.name === "Mushu Stockholm") next = CropFamily.MUSHROOM;
    return {
      zoneId: z.id,
      name: z.name,
      farmName: z.farm.name,
      current: z.defaultCropFamily,
      next,
    };
  });

  // Plan batch families + fix mis-classified row.
  const batchPlan: {
    id: string;
    batchNumber: string;
    zoneId: string;
    current: CropFamily | null;
    next: CropFamily;
    trayCount: number | null;
    phaseNow: BatchPhase;
    phaseNext: BatchPhase | null;
  }[] = batches.map((b) => {
    const isUrbanSeedsRack = b.zoneId === URBAN_SEEDS_RACK_ZONE_ID;
    const family = isUrbanSeedsRack ? CropFamily.MICROGREEN : CropFamily.MUSHROOM;
    const trayCount = isUrbanSeedsRack ? (b.trayCount ?? URBAN_SEEDS_TRAY_COUNT) : null;
    // If the current phase is invalid for the new family, remap. Only the
    // Sakura/COLONIZATION case exists in live data; catch anything else too.
    let phaseNext: BatchPhase | null = null;
    if (family === CropFamily.MICROGREEN) {
      const mushroomOnly = new Set<BatchPhase>([
        BatchPhase.COLONIZATION,
        BatchPhase.FRUITING,
        BatchPhase.READY_TO_HARVEST,
      ]);
      if (mushroomOnly.has(b.phase)) phaseNext = BatchPhase.GERMINATION;
    }
    if (b.id === MISCLASSIFIED_BATCH_ID) phaseNext = BatchPhase.GERMINATION;
    return {
      id: b.id,
      batchNumber: b.batchNumber,
      zoneId: b.zoneId,
      current: b.cropFamily,
      next: family,
      trayCount,
      phaseNow: b.phase,
      phaseNext,
    };
  });

  console.log("\nZone default-family plan:");
  for (const z of zonePlan) {
    const change =
      z.current === z.next
        ? "  (no change)"
        : `  ${z.current ?? "null"} → ${z.next ?? "null"}`;
    console.log(`  [${z.farmName}] ${z.name}${change}`);
  }

  console.log("\nBatch reclassification plan:");
  for (const b of batchPlan) {
    const parts: string[] = [];
    if (b.current !== b.next) parts.push(`family ${b.current ?? "null"} → ${b.next}`);
    if (b.phaseNext) parts.push(`phase ${b.phaseNow} → ${b.phaseNext}`);
    if (b.trayCount !== null) parts.push(`trayCount=${b.trayCount}`);
    if (parts.length > 0) {
      console.log(`  ${b.batchNumber} (${b.id.slice(0, 12)}…): ${parts.join(", ")}`);
    }
  }

  if (DRY) {
    console.log("\n[--dry] No writes. Re-run without --dry to apply.");
    return;
  }

  console.log("\nWriting…");
  await prisma.$transaction([
    ...zonePlan
      .filter((z) => z.next !== z.current)
      .map((z) =>
        prisma.zone.update({
          where: { id: z.zoneId },
          data: { defaultCropFamily: z.next },
        })
      ),
    ...batchPlan.map((b) =>
      prisma.batch.update({
        where: { id: b.id },
        data: {
          cropFamily: b.next,
          ...(b.phaseNext ? { phase: b.phaseNext } : {}),
          ...(b.trayCount !== null ? { trayCount: b.trayCount } : {}),
          // Clear mushroom fields on microgreen batches so the row is
          // internally consistent — no more phantom "10 bags (straw)"
          // displayed under a microgreens batch.
          ...(b.next === CropFamily.MICROGREEN
            ? { bagCount: null, substrate: null }
            : {}),
        },
      })
    ),
  ]);
  console.log(`Done. Wrote ${zonePlan.filter((z) => z.next !== z.current).length} zones + ${batchPlan.length} batches.`);

  // Sanity: verify B-2026-014
  const check = await prisma.batch.findUnique({
    where: { id: MISCLASSIFIED_BATCH_ID },
    select: { batchNumber: true, cropType: true, cropFamily: true, phase: true, trayCount: true },
  });
  console.log(`\nB-2026-014 after backfill: ${JSON.stringify(check)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
