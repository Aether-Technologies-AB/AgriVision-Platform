/**
 * Backfill EnergyReading.deltaKwh + costKr + seed DeviceEnergyState.
 *
 * Walks rows in timestamp order, grouped by (farmId, deviceName), and applies
 * the same delta rule the ingest route uses going forward:
 *   - First reading per device: deltaKwh = 0 (we don't know what came before).
 *   - current < previous (counter reset): deltaKwh = current.
 *   - Otherwise: deltaKwh = current - previous.
 *
 * costKr is recomputed as deltaKwh * farm.electricityPriceKrPerKwh so the
 * stored cost matches the stored delta.
 *
 * After the walk, DeviceEnergyState is upserted with each device's final
 * counter — so the next live Pi push lines up with the backfilled history.
 *
 * Run with --dry to see what would change without writing.
 *
 * Usage:
 *   npx tsx scripts/20260630_backfill_energy_deltas.ts --dry
 *   npx tsx scripts/20260630_backfill_energy_deltas.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DRY = process.argv.includes("--dry");

function computeDelta(current: number, previous: number | null): number {
  if (previous === null) return 0;
  if (current < previous) return current;
  return current - previous;
}

async function main() {
  const farms = await prisma.farm.findMany({
    select: { id: true, name: true, electricityPriceKrPerKwh: true },
  });
  const farmPrice = new Map(farms.map((f) => [f.id, f.electricityPriceKrPerKwh]));

  const allReadings = await prisma.energyReading.findMany({
    orderBy: [{ farmId: "asc" }, { deviceName: "asc" }, { timestamp: "asc" }],
    select: {
      id: true,
      farmId: true,
      deviceName: true,
      kWh: true,
      deltaKwh: true,
      costKr: true,
      timestamp: true,
    },
  });

  console.log(`Found ${allReadings.length} EnergyReading row(s) across ${farms.length} farm(s).`);
  if (allReadings.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // (farmId, deviceName) → last counter walked so far
  const running = new Map<string, number>();
  const updates: {
    id: string;
    deltaKwh: number;
    costKr: number;
    deviceName: string;
    farmId: string;
    kWh: number;
  }[] = [];

  for (const r of allReadings) {
    const key = `${r.farmId}::${r.deviceName}`;
    const prev = running.has(key) ? running.get(key)! : null;
    const deltaKwh = computeDelta(r.kWh, prev);
    const price = farmPrice.get(r.farmId) ?? 1.5;
    const costKr = deltaKwh * price;
    updates.push({
      id: r.id,
      deltaKwh,
      costKr,
      deviceName: r.deviceName,
      farmId: r.farmId,
      kWh: r.kWh,
    });
    running.set(key, r.kWh);
  }

  // Per-device summary so the human running this can sanity-check.
  const summary = new Map<
    string,
    { count: number; finalCounter: number; deltaSum: number; resets: number }
  >();
  for (const u of updates) {
    const key = `${u.farmId}::${u.deviceName}`;
    const s = summary.get(key) ?? {
      count: 0,
      finalCounter: 0,
      deltaSum: 0,
      resets: 0,
    };
    s.count += 1;
    s.finalCounter = u.kWh;
    s.deltaSum += u.deltaKwh;
    // Heuristic: delta == counter and counter > 0 means we treated this row as
    // either "first reading" or "reset". The first reading is deltaKwh=0, so
    // any non-zero delta == counter is a reset.
    if (u.deltaKwh > 0 && Math.abs(u.deltaKwh - u.kWh) < 1e-9) s.resets += 1;
    summary.set(key, s);
  }

  console.log("\nPer-device backfill summary:");
  console.log("(farm, device) — rows | final counter | sum(delta) | resets");
  for (const [key, s] of summary) {
    console.log(
      `  ${key} — ${s.count} | ${s.finalCounter.toFixed(3)} kWh | ${s.deltaSum.toFixed(3)} kWh | ${s.resets}`
    );
  }

  if (DRY) {
    console.log("\n[--dry] No writes. Re-run without --dry to apply.");
    return;
  }

  console.log(`\nWriting deltaKwh + costKr to ${updates.length} rows…`);
  // Bulk UPDATE … FROM (VALUES …) — one statement per chunk, much faster than
  // N round-trips. Chunk to keep statement size sane.
  const CHUNK = 2000;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    // Build a VALUES literal: (id::text, delta::float8, cost::float8)
    const values = chunk
      .map(
        (u) =>
          `('${u.id}'::text, ${u.deltaKwh}::float8, ${u.costKr}::float8)`
      )
      .join(",");
    const sql = `
      UPDATE "EnergyReading" AS er
      SET "deltaKwh" = v.d, "costKr" = v.c
      FROM (VALUES ${values}) AS v(id, d, c)
      WHERE er."id" = v.id
    `;
    await prisma.$executeRawUnsafe(sql);
    if ((i / CHUNK) % 10 === 0 || i + CHUNK >= updates.length) {
      console.log(`  …${Math.min(i + CHUNK, updates.length)} / ${updates.length}`);
    }
  }
  console.log(`Updated ${updates.length} EnergyReading row(s).`);

  console.log("\nSeeding DeviceEnergyState with each device's final counter…");
  for (const [key, s] of summary) {
    const [farmId, deviceName] = key.split("::");
    await prisma.deviceEnergyState.upsert({
      where: { farmId_deviceName: { farmId, deviceName } },
      create: { farmId, deviceName, lastCounterKwh: s.finalCounter },
      update: { lastCounterKwh: s.finalCounter },
    });
  }
  console.log(`Seeded ${summary.size} DeviceEnergyState row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
