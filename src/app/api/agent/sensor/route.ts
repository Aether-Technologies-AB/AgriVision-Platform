import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { zoneId, temperature, humidity, co2, vpd, battery } =
      await request.json();

    if (!zoneId || temperature === undefined || humidity === undefined) {
      return NextResponse.json(
        { error: "zoneId, temperature, and humidity are required" },
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

    const stale =
      !zone.agentLastSeen ||
      Date.now() - new Date(zone.agentLastSeen).getTime() > 3600_000;

    const writes: Promise<unknown>[] = [
      prisma.sensorReading.create({
        data: {
          zoneId,
          temperature,
          humidity,
          co2: co2 ?? null,
          vpd: vpd ?? null,
          battery: battery ?? null,
        },
      }),
    ];

    if (stale || zone.agentStatus !== "ONLINE") {
      writes.push(
        prisma.zone.update({
          where: { id: zoneId },
          data: {
            agentStatus: "ONLINE",
            agentLastSeen: new Date(),
          },
        })
      );
    }

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
