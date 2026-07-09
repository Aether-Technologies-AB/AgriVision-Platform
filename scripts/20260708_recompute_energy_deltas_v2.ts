/**
 * Recompute EnergyReading.deltaKwh + costKr with the hardened reset/jitter
 * logic (see src/app/api/agent/energy/route.ts).
 *
 * The original delta rule (`current < previous -> delta = current`) can't
 * tell a genuine counter reset apart from ordinary measurement jitter (Tapo's
 * rolling energy estimate isn't perfectly monotonic between two closely
 * spaced polls). Any tiny backwards step got billed as the ENTIRE lifetime
 * counter for that interval — ~29-30 kWh false spikes, once or twice an
 * hour, per device. This script walks every row again, per (farmId,
 * deviceName), in strict timestamp order, and applies:
 *
 *   - Genuine reset: only when the new counter is near zero AND the old
 *     counter was well above that (a real reset drop is "most of the
 *     counter", not "a hair less than before").
 *   - Otherwise a backwards step is jitter -> delta = 0, never negative,
 *     never the full counter.
 *   - Every delta (reset or forward) is capped at what's physically
 *     plausible for the elapsed time since the previous row for that
 *     device, so one bad reading can never blow up the sum.
 *
 * Run with --dry to see what would change without writing.
 *
 * Usage:
 *   npx tsx scripts/20260708_recompute_energy_deltas_v2.ts --dry [--farm=<farmId>]
 *   npx tsx scripts/20260708_recompute_energy_deltas_v2.ts [--farm=<farmId>]
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DRY = process.argv.includes("--dry");
const FARM_ARG = process.argv.find((a) => a.startsWith("--farm="))?.split("=")[1];

const RESET_NEAR_ZERO_KWH = 1.0;
const MAX_DEVICE_KW = 10;
const MIN_ELAPSED_HOURS = 1 / 60;

function computeDelta(current: number, previous: number | null, elapsedHours: number): number {
  if (previous === null) return 0;
  const maxPlausibleDelta = MAX_DEVICE_KW * Math.max(elapsedHours, MIN_ELAPSED_HOURS);
  if (current < previous) {
    const isGenuineReset = current < RESET_NEAR_ZERO_KWH && previous > RESET_NEAR_ZERO_KWH;
    if (isGenuineReset) return Math.min(current, maxPlausibleDelta);
    return 0;
  }
  return Math.min(current - previous, maxPlausibleDelta);
}

async function main() {
  const farms = await prisma.farm.findMany({
    where: FARM_ARG ? { id: FARM_ARG } : undefined,
    select: { id: true, name: true, electricityPriceKrPerKwh: true },
  });
  const farmPrice = new Map(farms.map((f) => [f.id, f.electricityPriceKrPerKwh]));
  const farmIds = farms.map((f) => f.id);

  const allReadings = await prisma.energyReading.findMany({
    where: { farmId: { in: farmIds } },
    orderBy: [{ farmId: "asc" }, { deviceName: "asc" }, { timestamp: "asc" }, { id: "asc" }],
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
    console.log("Nothing to recompute.");
    return;
  }

  const running = new Map<string, { kWh: number; ts: Date }>();
  const updates: {
    id: string;
    deltaKwh: number;
    costKr: number;
    deviceName: string;
    farmId: string;
    kWh: number;
    oldDeltaKwh: number;
  }[] = [];

  for (const r of allReadings) {
    const key = `${r.farmId}::${r.deviceName}`;
    const prevState = running.get(key) ?? null;
    const elapsedHours = prevState ? (r.timestamp.getTime() - prevState.ts.getTime()) / 3_600_000 : 24;
    const deltaKwh = computeDelta(r.kWh, prevState?.kWh ?? null, elapsedHours);
    const price = farmPrice.get(r.farmId) ?? 1.5;
    updates.push({
      id: r.id,
      deltaKwh,
      costKr: deltaKwh * price,
      deviceName: r.deviceName,
      farmId: r.farmId,
      kWh: r.kWh,
      oldDeltaKwh: r.deltaKwh ?? 0,
    });
    running.set(key, { kWh: r.kWh, ts: r.timestamp });
  }

  const farmName = new Map(farms.map((f) => [f.id, f.name]));
  const summary = new Map<
    string,
    { count: number; finalCounter: number; oldSum: number; newSum: number }
  >();
  for (const u of updates) {
    const key = `${u.farmId}::${u.deviceName}`;
    const s = summary.get(key) ?? { count: 0, finalCounter: 0, oldSum: 0, newSum: 0 };
    s.count += 1;
    s.finalCounter = u.kWh;
    s.oldSum += u.oldDeltaKwh;
    s.newSum += u.deltaKwh;
    summary.set(key, s);
  }

  console.log("\nPer-device recompute summary:");
  console.log("(farm, device) — rows | old sum(delta) | new sum(delta)");
  for (const [key, s] of summary) {
    const [farmId, deviceName] = key.split("::");
    console.log(
      `  ${farmName.get(farmId)} / ${deviceName} — ${s.count} rows | OLD ${s.oldSum.toFixed(3)} kWh | NEW ${s.newSum.toFixed(3)} kWh`
    );
  }

  if (DRY) {
    console.log("\n[--dry] No writes. Re-run without --dry to apply.");
    return;
  }

  console.log(`\nWriting deltaKwh + costKr to ${updates.length} rows…`);
  const CHUNK = 2000;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const values = chunk
      .map((u) => `('${u.id}'::text, ${u.deltaKwh}::float8, ${u.costKr}::float8)`)
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

  console.log("\nSyncing DeviceEnergyState with each device's final counter + timestamp…");
  for (const [key, s] of summary) {
    const [farmId, deviceName] = key.split("::");
    await prisma.deviceEnergyState.upsert({
      where: { farmId_deviceName: { farmId, deviceName } },
      create: { farmId, deviceName, lastCounterKwh: s.finalCounter },
      update: { lastCounterKwh: s.finalCounter },
    });
  }
  console.log(`Synced ${summary.size} DeviceEnergyState row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
