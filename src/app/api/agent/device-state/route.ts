import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { zoneId, farmId, deviceType, deviceName, state, scope } =
      await request.json();

    if (!deviceType || !deviceName || state === undefined) {
      return NextResponse.json(
        { error: "deviceType, deviceName, and state are required" },
        { status: 400 },
      );
    }

    const deviceScope = scope === "FARM" ? "FARM" : "ZONE";

    // For farm-scoped devices, farmId is required; for zone-scoped, zoneId is required
    if (deviceScope === "FARM" && !farmId) {
      return NextResponse.json(
        { error: "farmId is required for farm-scoped devices" },
        { status: 400 },
      );
    }
    if (deviceScope === "ZONE" && !zoneId) {
      return NextResponse.json(
        { error: "zoneId is required for zone-scoped devices" },
        { status: 400 },
      );
    }

    // Resolve farmId from zone if not provided
    let resolvedFarmId = farmId;
    if (zoneId) {
      const zone = await prisma.zone.findUnique({
        where: { id: zoneId },
        include: { farm: true },
      });
      if (!zone || zone.farm.organizationId !== apiKey!.organizationId) {
        return NextResponse.json(
          { error: "Zone not found or access denied" },
          { status: 403 },
        );
      }
      resolvedFarmId = resolvedFarmId || zone.farmId;
    }

    if (!resolvedFarmId) {
      return NextResponse.json({ error: "Could not resolve farmId" }, { status: 400 });
    }

    // Verify farm belongs to org
    if (deviceScope === "FARM") {
      const farm = await prisma.farm.findUnique({
        where: { id: resolvedFarmId },
        select: { organizationId: true },
      });
      if (!farm || farm.organizationId !== apiKey!.organizationId) {
        return NextResponse.json({ error: "Farm not found or access denied" }, { status: 403 });
      }
    }

    // Upsert device state using the new unique constraint
    const device = await prisma.deviceState.upsert({
      where: {
        farmId_scope_deviceType_deviceName: {
          farmId: resolvedFarmId,
          scope: deviceScope,
          deviceType,
          deviceName,
        },
      },
      update: {
        state: !!state,
        lastToggled: new Date(),
        zoneId: deviceScope === "ZONE" ? zoneId : null,
      },
      create: {
        farmId: resolvedFarmId,
        zoneId: deviceScope === "ZONE" ? zoneId : null,
        scope: deviceScope,
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
      { status: 500 },
    );
  }
}
