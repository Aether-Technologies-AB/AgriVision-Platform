import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { zoneId } = await params;

    // Verify zone belongs to user's org
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json(
        { error: "Zone not found" },
        { status: 404 }
      );
    }

    // Fetch latest data in parallel
    const [sensor, devices, latestPhoto, activeBatch, recentDecisions] =
      await Promise.all([
        // Latest sensor reading
        prisma.sensorReading.findFirst({
          where: { zoneId },
          orderBy: { timestamp: "desc" },
        }),
        // Device states — zone-specific + farm-wide, updated in last hour
        prisma.deviceState.findMany({
          where: {
            OR: [
              { zoneId },
              { farmId: zone.farmId, scope: "FARM" },
            ],
            updatedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          orderBy: { deviceName: "asc" },
        }),
        // Latest photo
        prisma.photo.findFirst({
          where: { zoneId, rgbUrl: { not: "" } },
          orderBy: { timestamp: "desc" },
          select: {
            id: true,
            rgbUrl: true,
            depthUrl: true,
            analysis: true,
            timestamp: true,
          },
        }),
        // Active batch — anything that isn't pre-start (PLANNED) or finished
        // (HARVESTED / CANCELLED). This used to whitelist only mushroom phases
        // and silently drop every microgreens batch on the Urban Seeds Rack.
        // Now we blacklist the terminal + pending states so any future phase
        // (mushroom or microgreens) is picked up automatically.
        prisma.batch.findFirst({
          where: {
            zoneId,
            phase: { notIn: ["PLANNED", "HARVESTED", "CANCELLED"] },
          },
          orderBy: { plantedAt: "desc" },
        }),
        // Recent AI decisions — only from batches in this zone, newest first
        prisma.aIDecision.findMany({
          where: {
            batch: { zoneId },
          },
          orderBy: { timestamp: "desc" },
          take: 10,
          select: {
            id: true,
            decisionType: true,
            decision: true,
            reasoning: true,
            actionTaken: true,
            costKr: true,
            timestamp: true,
          },
        }),
      ]);

    // Today's energy for this zone
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    // Sum deltaKwh (per-poll consumption), NOT kWh (raw lifetime / today-so-
    // far counter the Pi reports). Pre-fix rows with deltaKwh=NULL contribute
    // nothing — which is correct, since their kWh values were the raw counter
    // and can't be re-interpreted here.
    const energyToday = await prisma.energyReading.aggregate({
      where: {
        OR: [
          { zoneId },
          { farmId: zone.farmId, zoneId: null },
        ],
        timestamp: { gte: todayStart },
      },
      _sum: { deltaKwh: true, costKr: true },
    });

    // Get sensor reading from ~1h ago for trend comparison
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sensorOneHourAgo = await prisma.sensorReading.findFirst({
      where: {
        zoneId,
        timestamp: { lte: oneHourAgo },
      },
      orderBy: { timestamp: "desc" },
    });

    // Calculate day of batch
    let batchDay: number | null = null;
    let estCycleDays: number | null = null;
    if (activeBatch?.plantedAt) {
      batchDay = Math.floor(
        (Date.now() - activeBatch.plantedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (activeBatch.estHarvestDate) {
        estCycleDays = Math.floor(
          (activeBatch.estHarvestDate.getTime() -
            activeBatch.plantedAt.getTime()) /
            (1000 * 60 * 60 * 24)
        );
      }
    }

    return NextResponse.json({
      sensor: sensor
        ? {
            temperature: sensor.temperature,
            humidity: sensor.humidity,
            co2: sensor.co2,
            vpd: sensor.vpd,
            ph: sensor.ph,
            ec: sensor.ec,
            waterTemp: sensor.waterTemp,
            timestamp: sensor.timestamp,
          }
        : null,
      sensorPrev: sensorOneHourAgo
        ? {
            temperature: sensorOneHourAgo.temperature,
            humidity: sensorOneHourAgo.humidity,
            co2: sensorOneHourAgo.co2,
            vpd: sensorOneHourAgo.vpd,
            ph: sensorOneHourAgo.ph,
            ec: sensorOneHourAgo.ec,
            waterTemp: sensorOneHourAgo.waterTemp,
          }
        : null,
      // Data-driven gate: true only when the latest reading carries water
      // chemistry. Zones without an EZO probe (Mushu, Urban Seeds, …) have all
      // three NULL → false → water UI never renders. No Zone flag needed.
      hasWater: !!(
        sensor &&
        (sensor.ph !== null ||
          sensor.ec !== null ||
          sensor.waterTemp !== null)
      ),
      devices: devices.map((d: any) => ({
        id: d.id,
        type: d.deviceType,
        name: d.deviceName,
        state: d.state,
        lastToggled: d.lastToggled,
        scope: d.scope,
      })),
      agent: {
        status: zone.agentStatus,
        lastSeen: zone.agentLastSeen,
        autoMode: zone.autoMode,
        phase: zone.currentPhase,
      },
      latestPhoto,
      activeBatch: activeBatch
        ? {
            id: activeBatch.id,
            batchNumber: activeBatch.batchNumber,
            cropType: activeBatch.cropType,
            cropFamily: activeBatch.cropFamily,
            phase: activeBatch.phase,
            day: batchDay,
            estCycleDays,
            estHarvestDate: activeBatch.estHarvestDate,
            estYieldKg: activeBatch.estYieldKg,
            healthScore: activeBatch.healthScore,
            trayCount: activeBatch.trayCount,
            growthDay: activeBatch.growthDay,
          }
        : null,
      recentDecisions,
      energy: {
        todayKwh: Math.round((energyToday._sum.deltaKwh || 0) * 1000) / 1000,
        todayCostKr: Math.round((energyToday._sum.costKr || 0) * 100) / 100,
      },
    });
  } catch (err) {
    console.error("Dashboard live error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
