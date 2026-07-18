import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { getActiveBatchId } from "@/lib/active-batch";
import { agentSeenUpdate } from "@/lib/agent-liveness";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { zoneId, temperature, humidity, co2, vpd, battery, ph, ec, waterTemp } =
      await request.json();

    // temperature/humidity are optional: a dedicated water/CO2 agent pushes
    // ph/ec/waterTemp/co2 without touching the air readings the GGS agent owns.
    // Require zoneId + at least one sensor value so we never store an empty row.
    const hasAnyMetric = [temperature, humidity, co2, vpd, ph, ec, waterTemp].some(
      (v) => v !== undefined && v !== null
    );
    if (!zoneId || !hasAnyMetric) {
      return NextResponse.json(
        { error: "zoneId and at least one sensor value are required" },
        { status: 400 }
      );
    }

    // Verify zone belongs to the key's organization
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== apiKey!.organizationId) {
      return NextResponse.json(
        { error: "Zone not found or access denied" },
        { status: 403 }
      );
    }

    // Best-effort batch stamping — losing the association is acceptable,
    // losing the reading is not.
    let batchId: string | null = null;
    try {
      batchId = await getActiveBatchId(zoneId);
    } catch (err) {
      console.error("getActiveBatchId failed, writing reading unstamped:", err);
    }

    const writes: Promise<unknown>[] = [
      prisma.sensorReading.create({
        data: {
          zoneId,
          batchId,
          temperature: temperature ?? null,
          humidity: humidity ?? null,
          co2: co2 ?? null,
          vpd: vpd ?? null,
          battery: battery ?? null,
          // Water-chemistry / reservoir (Atlas EZO) — optional; only zones with
          // an EZO probe send these. Absent keys persist as NULL (no behavior
          // change for existing air-only agents).
          ph: ph ?? null,
          ec: ec ?? null,
          waterTemp: waterTemp ?? null,
        },
      }),
    ];

    // Mark the zone's agent alive (shared with the other edge-ingest routes).
    const livenessWrite = agentSeenUpdate(zone);
    if (livenessWrite) writes.push(livenessWrite);

    const [reading] = (await Promise.all(writes)) as [{ id: string }];

    return NextResponse.json({ id: reading.id }, { status: 201 });
  } catch (err) {
    console.error("Agent sensor error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
