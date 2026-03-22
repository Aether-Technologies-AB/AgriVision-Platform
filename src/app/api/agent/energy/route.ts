import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error || !apiKey) {
    return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 });
  }

  try {
    const { farmId, zoneId, deviceName, kWh } = await request.json();

    if (!farmId || !deviceName || kWh == null) {
      return NextResponse.json(
        { error: "farmId, deviceName, and kWh are required" },
        { status: 400 }
      );
    }

    // Verify farm belongs to the API key's org
    const farm = await prisma.farm.findUnique({
      where: { id: farmId },
      select: { organizationId: true, electricityPriceKrPerKwh: true },
    });

    if (!farm || farm.organizationId !== apiKey.organizationId) {
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }

    const costKr = kWh * farm.electricityPriceKrPerKwh;

    const reading = await prisma.energyReading.create({
      data: {
        farmId,
        zoneId: zoneId || null,
        deviceName,
        kWh,
        costKr,
      },
    });

    return NextResponse.json({ id: reading.id, costKr }, { status: 201 });
  } catch (err) {
    console.error("Energy reading error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
