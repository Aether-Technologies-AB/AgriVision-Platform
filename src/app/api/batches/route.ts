import { NextRequest, NextResponse } from "next/server";
import { CropFamily } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { resolveCropFamily } from "@/lib/crop-family";

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
    const body = await request.json();
    const {
      cropType,
      cropFamily,
      substrate,
      bagCount,
      trayCount,
      seedingDensityGSqm,
      plantedAt,
      notes,
      substrateCost,
      laborCost,
    } = body;

    // Support both single zoneId and multi zoneIds
    const zoneIds: string[] = body.zoneIds || (body.zoneId ? [body.zoneId] : []);

    if (zoneIds.length === 0 || !cropType) {
      return NextResponse.json(
        { error: "At least one zone and cropType are required" },
        { status: 400 }
      );
    }

    // Verify all zones belong to user's org
    const zones = await prisma.zone.findMany({
      where: { id: { in: zoneIds } },
      include: { farm: true },
    });

    if (zones.length !== zoneIds.length) {
      return NextResponse.json({ error: "One or more zones not found" }, { status: 404 });
    }

    for (const z of zones) {
      if (z.farm.organizationId !== session.user.organizationId) {
        return NextResponse.json({ error: "Access denied to one or more zones" }, { status: 403 });
      }
    }

    // Family resolution — must succeed BEFORE we start numbering batches.
    // Per-zone since Zone.defaultCropFamily can differ. Reject with a clear
    // error rather than guessing (see src/lib/crop-family.ts).
    const familyByZone = new Map<string, CropFamily>();
    for (const z of zones) {
      const fam = resolveCropFamily({
        explicit: cropFamily,
        cropType,
        zoneDefault: z.defaultCropFamily,
      });
      if (!fam) {
        return NextResponse.json(
          {
            error:
              `Cannot determine cropFamily for zone "${z.name}" with cropType="${cropType}". ` +
              `Pass cropFamily explicitly (MUSHROOM|MICROGREEN) or set the zone's default family.`,
          },
          { status: 400 }
        );
      }
      familyByZone.set(z.id, fam);
    }

    // Family-specific field validation — mushroom batches need bagCount,
    // microgreen batches accept trayCount but don't require it (a tray count
    // may not be known at creation time and can be filled in later).
    const missingBagCount = Array.from(familyByZone.values()).some(
      (f) => f === CropFamily.MUSHROOM
    );
    if (missingBagCount && (!bagCount || bagCount < 1)) {
      return NextResponse.json(
        { error: "bagCount (>= 1) is required for mushroom batches" },
        { status: 400 }
      );
    }

    // Generate batch numbers — find highest existing number this year
    const year = new Date().getFullYear();
    const prefix = `B-${year}-`;
    const latest = await prisma.batch.findFirst({
      where: { batchNumber: { startsWith: prefix } },
      orderBy: { batchNumber: "desc" },
      select: { batchNumber: true },
    });
    let lastNum = latest
      ? parseInt(latest.batchNumber.replace(prefix, ""), 10)
      : 0;

    const created = [];
    for (const zId of zoneIds) {
      lastNum++;
      const batchNumber = `${prefix}${String(lastNum).padStart(3, "0")}`;
      const family = familyByZone.get(zId)!;
      const isMushroom = family === CropFamily.MUSHROOM;
      const batch = await prisma.batch.create({
        data: {
          batchNumber,
          zoneId: zId,
          cropType,
          cropFamily: family,
          substrate: isMushroom ? (substrate ?? null) : null,
          bagCount: isMushroom ? bagCount : null,
          trayCount: !isMushroom && typeof trayCount === "number" ? trayCount : null,
          seedingDensityGSqm:
            !isMushroom && typeof seedingDensityGSqm === "number"
              ? seedingDensityGSqm
              : null,
          substrateCost: substrateCost ?? null,
          laborCost: laborCost ?? null,
          phase: "PLANNED",
          plantedAt: plantedAt ? new Date(plantedAt) : null,
          notes: notes || null,
        },
      });
      created.push({ id: batch.id, batchNumber: batch.batchNumber });
    }

    return NextResponse.json(
      { batches: created, id: created[0].id, batchNumber: created[0].batchNumber },
      { status: 201 }
    );
  } catch (err) {
    console.error("Batch create error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
