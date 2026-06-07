import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

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

    // Verify farm belongs to the API key's org
    const farm = await prisma.farm.findUnique({
      where: { id: farmId },
      select: { organizationId: true, electricityPriceKrPerKwh: true },
    });

    if (!farm || farm.organizationId !== apiKey.organizationId) {
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }

    // Support both single and batched readings
    const readings: { deviceName: string; kWh: number }[] = body.readings
      ? body.readings
      : [{ deviceName: body.deviceName, kWh: body.kWh }];

    if (readings.some((r: { deviceName: string; kWh: number }) => !r.deviceName || r.kWh == null)) {
      return NextResponse.json(
        { error: "Each reading requires deviceName and kWh" },
        { status: 400 }
      );
    }

    const created = await prisma.energyReading.createMany({
      data: readings.map((r: { deviceName: string; kWh: number }) => ({
        farmId,
        zoneId: zoneId || null,
        deviceName: r.deviceName,
        kWh: r.kWh,
        costKr: r.kWh * farm.electricityPriceKrPerKwh,
      })),
    });

    return NextResponse.json({ count: created.count }, { status: 201 });
  } catch (err) {
    console.error("Energy reading error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
