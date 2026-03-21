import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { zoneId, deviceType, deviceName, state } = await request.json();

    if (!zoneId || !deviceType || !deviceName || state === undefined) {
      return NextResponse.json(
        { error: "zoneId, deviceType, deviceName, and state are required" },
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

    // Upsert device state
    const device = await prisma.deviceState.upsert({
      where: {
        zoneId_deviceType_deviceName: {
          zoneId,
          deviceType,
          deviceName,
        },
      },
      update: {
        state: !!state,
        lastToggled: new Date(),
      },
      create: {
        zoneId,
        deviceType,
        deviceName,
        state: !!state,
        lastToggled: new Date(),
      },
    });

    return NextResponse.json({ id: device.id }, { status: 201 });
  } catch (err) {
    console.error("Agent device-state error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
