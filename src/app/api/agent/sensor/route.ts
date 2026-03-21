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

    // Create sensor reading and update zone status in parallel
    const [reading] = await Promise.all([
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
      prisma.zone.update({
        where: { id: zoneId },
        data: {
          agentStatus: "ONLINE",
          agentLastSeen: new Date(),
        },
      }),
    ]);

    return NextResponse.json({ id: reading.id }, { status: 201 });
  } catch (err) {
    console.error("Agent sensor error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
