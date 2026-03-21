import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = request.nextUrl.searchParams.get("status") || "all";

    const phaseFilter: Record<string, string[]> = {
      active: ["COLONIZATION", "FRUITING", "READY_TO_HARVEST"],
      completed: ["HARVESTED", "CANCELLED"],
      all: [],
    };

    const where: Record<string, unknown> = {
      zone: { farm: { organizationId: session.user.organizationId } },
    };

    const phases = phaseFilter[status];
    if (phases && phases.length > 0) {
      where.phase = { in: phases };
    }

    const batches = await prisma.batch.findMany({
      where,
      include: {
        zone: { select: { id: true, name: true } },
        harvests: { select: { profit: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = batches.map((b: any) => {
      let day: number | null = null;
      let estCycleDays: number | null = null;
      if (b.plantedAt) {
        const ref = b.harvestedAt || new Date();
        day = Math.floor(
          (ref.getTime() - b.plantedAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (b.estHarvestDate) {
          estCycleDays = Math.floor(
            (b.estHarvestDate.getTime() - b.plantedAt.getTime()) /
              (1000 * 60 * 60 * 24)
          );
        }
      }

      return {
        id: b.id,
        batchNumber: b.batchNumber,
        cropType: b.cropType,
        zone: b.zone,
        phase: b.phase,
        day,
        estCycleDays,
        estHarvestDate: b.estHarvestDate,
        estYieldKg: b.estYieldKg,
        healthScore: b.healthScore,
        actualYieldKg: b.actualYieldKg,
        actualProfit: b.actualProfit,
        createdAt: b.createdAt,
      };
    });

    return NextResponse.json({ batches: result });
  } catch (err) {
    console.error("Batches list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { zoneId, cropType, substrate, bagCount, plantedAt, notes } =
      await request.json();

    if (!zoneId || !cropType || !bagCount || bagCount < 1) {
      return NextResponse.json(
        { error: "zoneId, cropType, and bagCount (>= 1) are required" },
        { status: 400 }
      );
    }

    // Verify zone belongs to user's org
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json(
        { error: "Zone not found or access denied" },
        { status: 403 }
      );
    }

    // Generate batch number — find highest existing number this year
    const year = new Date().getFullYear();
    const prefix = `B-${year}-`;
    const latest = await prisma.batch.findFirst({
      where: { batchNumber: { startsWith: prefix } },
      orderBy: { batchNumber: "desc" },
      select: { batchNumber: true },
    });
    const lastNum = latest
      ? parseInt(latest.batchNumber.replace(prefix, ""), 10)
      : 0;
    const batchNumber = `${prefix}${String(lastNum + 1).padStart(3, "0")}`;

    const batch = await prisma.batch.create({
      data: {
        batchNumber,
        zoneId,
        cropType,
        substrate: substrate || "straw",
        bagCount,
        phase: "PLANNED",
        plantedAt: plantedAt ? new Date(plantedAt) : null,
        notes: notes || null,
      },
    });

    return NextResponse.json({ id: batch.id, batchNumber: batch.batchNumber }, { status: 201 });
  } catch (err) {
    console.error("Batch create error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
