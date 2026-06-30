import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

type Reading = { deviceName: string; kWh: number };

/**
 * Compute the consumption since the previous poll for one device.
 *
 *   - No prior reading: delta = 0. The first push from a device tells us
 *     where the counter is, not what it consumed — we can't bill that.
 *   - current < previous: counter reset (Shelly reboot, Tapo midnight
 *     rollover). Treat the new reading itself as the delta — it's what the
 *     device has consumed since the reset.
 *   - Otherwise: delta = current - previous.
 */
function computeDelta(current: number, previous: number | null): number {
  if (previous === null || previous === undefined) return 0;
  if (current < previous) return current;
  return current - previous;
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

    // Pull every device's prior counter in one query, indexed by deviceName.
    const deviceNames = Array.from(new Set(readings.map((r) => r.deviceName)));
    const priorStates = await prisma.deviceEnergyState.findMany({
      where: { farmId, deviceName: { in: deviceNames } },
    });
    const priorByDevice = new Map<string, number>();
    for (const s of priorStates) priorByDevice.set(s.deviceName, s.lastCounterKwh);

    // If the same device shows up twice in one batch, process in order and
    // carry the running counter forward in-memory so the second reading's
    // delta is correct without needing a DB roundtrip between rows.
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
      const deltaKwh = computeDelta(r.kWh, prev);
      rows.push({
        farmId,
        zoneId: zoneId || null,
        deviceName: r.deviceName,
        kWh: r.kWh,
        deltaKwh,
        costKr: deltaKwh * farm.electricityPriceKrPerKwh,
      });
      priorByDevice.set(r.deviceName, r.kWh);
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
