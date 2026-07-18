import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { markAgentSeen } from "@/lib/agent-liveness";

type Reading = { deviceName: string; kWh: number };

// A counter must fall below this to even be considered a genuine reset.
// Tapo/Shelly counters reboot to ~0, they don't drop to "a bit less than
// before" — a drop that doesn't land near zero is measurement jitter, not
// a reset (see computeDelta below).
const RESET_NEAR_ZERO_KWH = 1.0;
// Ceiling on plausible power draw for a single metered device/circuit, used
// to size the per-interval delta cap. Generous on purpose — sized to never
// clip a real farm-wide device, only to catch impossible spikes.
const MAX_DEVICE_KW = 10;
// Floor on the elapsed-time window used for the cap, so two pushes that
// land seconds apart (same-batch duplicate, fast retry) don't get an
// unbounded cap.
const MIN_ELAPSED_HOURS = 1 / 60;

/**
 * Compute the consumption since the previous poll for one device.
 *
 * Readings are cumulative lifetime counters. Two failure modes matter:
 *
 *   1. Genuine counter reset (device reboot / firmware rollover): the
 *      counter restarts near zero. Detected only when `current` itself is
 *      near zero AND `previous` was well above that — not merely
 *      `current < previous`. A real reset drop is "most of the counter",
 *      not "a hair less than before".
 *   2. Non-monotonic jitter: Tapo's rolling energy estimate isn't perfectly
 *      monotonic between two closely-spaced polls, so `current` can be a
 *      few grams-of-a-Wh below `previous` with no reset involved. Treating
 *      that as a reset (old behavior: delta = current) bills the ENTIRE
 *      lifetime counter as one interval's consumption — this produced
 *      ~29-30 kWh false spikes once an hour. The fix: any drop that doesn't
 *      qualify as a genuine reset contributes zero, never a negative or a
 *      full-counter delta.
 *
 * Every delta (reset or forward-moving) is additionally capped at what's
 * physically plausible for the elapsed interval, so a single bad reading
 * can never blow up the sum even if it slips past the rules above.
 */
function computeDelta(
  current: number,
  previous: number | null,
  elapsedHours: number
): number {
  if (previous === null || previous === undefined) return 0;

  const maxPlausibleDelta = MAX_DEVICE_KW * Math.max(elapsedHours, MIN_ELAPSED_HOURS);

  if (current < previous) {
    const isGenuineReset = current < RESET_NEAR_ZERO_KWH && previous > RESET_NEAR_ZERO_KWH;
    if (isGenuineReset) return Math.min(current, maxPlausibleDelta);
    return 0;
  }

  return Math.min(current - previous, maxPlausibleDelta);
}

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error || !apiKey) {
    return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { farmId, zoneId } = body;

    if (!farmId) {
      return NextResponse.json({ error: "farmId is required" }, { status: 400 });
    }

    const farm = await prisma.farm.findUnique({
      where: { id: farmId },
      select: { organizationId: true, electricityPriceKrPerKwh: true },
    });

    if (!farm || farm.organizationId !== apiKey.organizationId) {
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }

    const readings: Reading[] = body.readings
      ? body.readings
      : [{ deviceName: body.deviceName, kWh: body.kWh }];

    if (readings.some((r) => !r.deviceName || r.kWh == null)) {
      return NextResponse.json(
        { error: "Each reading requires deviceName and kWh" },
        { status: 400 }
      );
    }

    // Pull every device's prior counter + last-seen time in one query.
    const deviceNames = Array.from(new Set(readings.map((r) => r.deviceName)));
    const priorStates = await prisma.deviceEnergyState.findMany({
      where: { farmId, deviceName: { in: deviceNames } },
    });
    const priorByDevice = new Map<string, number>();
    const priorTimeByDevice = new Map<string, Date>();
    for (const s of priorStates) {
      priorByDevice.set(s.deviceName, s.lastCounterKwh);
      priorTimeByDevice.set(s.deviceName, s.updatedAt);
    }

    // If the same device shows up twice in one batch, process in order and
    // carry the running counter forward in-memory so the second reading's
    // delta is correct without needing a DB roundtrip between rows. The
    // second occurrence's "prior time" becomes this request's start time,
    // which collapses its elapsed-time window to the MIN_ELAPSED_HOURS
    // floor — appropriately conservative, since a legitimate second reading
    // for the same device within one push shouldn't represent real hours
    // of consumption anyway.
    const now = new Date();
    const rows: {
      farmId: string;
      zoneId: string | null;
      deviceName: string;
      kWh: number;
      deltaKwh: number;
      costKr: number;
    }[] = [];

    for (const r of readings) {
      const prev = priorByDevice.has(r.deviceName)
        ? priorByDevice.get(r.deviceName)!
        : null;
      const priorTime = priorTimeByDevice.get(r.deviceName) ?? null;
      const elapsedHours = priorTime ? (now.getTime() - priorTime.getTime()) / 3_600_000 : 24;
      const deltaKwh = computeDelta(r.kWh, prev, elapsedHours);
      rows.push({
        farmId,
        zoneId: zoneId || null,
        deviceName: r.deviceName,
        kWh: r.kWh,
        deltaKwh,
        costKr: deltaKwh * farm.electricityPriceKrPerKwh,
      });
      priorByDevice.set(r.deviceName, r.kWh);
      priorTimeByDevice.set(r.deviceName, now);
    }

    // Write rows + upsert each device's running counter. Sequential upserts
    // because Prisma doesn't have an atomic multi-row upsert; the row count
    // per push is tiny (≤ number of Tapo/Shelly devices on the farm).
    await prisma.$transaction([
      prisma.energyReading.createMany({ data: rows }),
      ...deviceNames.map((name) => {
        const finalCounter = priorByDevice.get(name)!;
        return prisma.deviceEnergyState.upsert({
          where: { farmId_deviceName: { farmId, deviceName: name } },
          create: { farmId, deviceName: name, lastCounterKwh: finalCounter },
          update: { lastCounterKwh: finalCounter },
        });
      }),
    ]);

    // For a zone-scoped push, the edge agent is alive — mark its zone seen.
    // Skipped for farm-wide readings (zoneId null: no single zone to attribute
    // liveness to). Tenancy: only if the zone actually belongs to this farm.
    // Best-effort — never fails a successful energy write.
    if (zoneId) {
      const zone = await prisma.zone.findUnique({
        where: { id: zoneId },
        select: { id: true, farmId: true, agentLastSeen: true, agentStatus: true },
      });
      if (zone && zone.farmId === farmId) {
        await markAgentSeen(zone);
      }
    }

    return NextResponse.json(
      {
        count: rows.length,
        deltas: rows.map((r) => ({
          deviceName: r.deviceName,
          deltaKwh: r.deltaKwh,
          costKr: r.costKr,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Energy reading error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
