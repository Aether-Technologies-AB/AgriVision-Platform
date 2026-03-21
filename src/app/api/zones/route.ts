import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const farmId = request.nextUrl.searchParams.get("farmId");
    const detail = request.nextUrl.searchParams.get("detail") === "true";

    const where: Record<string, any> = {
      farm: { organizationId: session.user.organizationId },
    };
    if (farmId) {
      where.farm.id = farmId;
    }

    if (detail) {
      // Full data for zone map
      const zones = await prisma.zone.findMany({
        where,
        include: {
          farm: { select: { id: true, name: true } },
          batches: {
            where: {
              phase: { in: ["PLANNED", "COLONIZATION", "FRUITING", "READY_TO_HARVEST"] },
            },
            select: {
              id: true,
              batchNumber: true,
              cropType: true,
              phase: true,
              plantedAt: true,
              estHarvestDate: true,
              healthScore: true,
            },
            orderBy: { createdAt: "desc" },
          },
          sensorReadings: {
            orderBy: { timestamp: "desc" },
            take: 1,
            select: {
              temperature: true,
              humidity: true,
              timestamp: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      const result = zones.map((z: any) => ({
        id: z.id,
        name: z.name,
        agentStatus: z.agentStatus,
        agentLastSeen: z.agentLastSeen,
        currentPhase: z.currentPhase,
        farm: z.farm,
        batches: z.batches.map((b: any) => {
          let day: number | null = null;
          let estCycleDays: number | null = null;
          if (b.plantedAt) {
            day = Math.floor((Date.now() - b.plantedAt.getTime()) / (1000 * 60 * 60 * 24));
            if (b.estHarvestDate) {
              estCycleDays = Math.floor(
                (b.estHarvestDate.getTime() - b.plantedAt.getTime()) / (1000 * 60 * 60 * 24)
              );
            }
          }
          return { ...b, day, estCycleDays };
        }),
        sensor: z.sensorReadings[0] || null,
      }));

      return NextResponse.json({ zones: result });
    }

    // Simple list for dropdowns
    const zones = await prisma.zone.findMany({
      where,
      select: {
        id: true,
        name: true,
        agentStatus: true,
        currentPhase: true,
        farm: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ zones });
  } catch (err) {
    console.error("Zones list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
