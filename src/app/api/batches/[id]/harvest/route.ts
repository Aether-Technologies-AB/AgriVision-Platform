import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const {
      weightKg,
      qualityGrade,
      pricePerKg,
      energyCost,
      substrateCost,
      laborCost,
    } = await request.json();

    if (!weightKg || !qualityGrade || !pricePerKg) {
      return NextResponse.json(
        { error: "weightKg, qualityGrade, and pricePerKg are required" },
        { status: 400 }
      );
    }

    // Verify batch belongs to user's org
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: { zone: { include: { farm: true } } },
    });

    if (!batch || batch.zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const revenue = weightKg * pricePerKg;
    const totalCost = (energyCost || 0) + (substrateCost || 0) + (laborCost || 0);
    const profit = revenue - totalCost;
    const costPerGram = totalCost / (weightKg * 1000);

    // Create harvest and update batch in a transaction
    const [harvest] = await prisma.$transaction([
      prisma.harvest.create({
        data: {
          batchId: id,
          weightKg,
          qualityGrade,
          pricePerKg,
          revenue,
          energyCost: energyCost || null,
          substrateCost: substrateCost || null,
          laborCost: laborCost || null,
          totalCost,
          profit,
          costPerGram,
        },
      }),
      prisma.batch.update({
        where: { id },
        data: {
          phase: "HARVESTED",
          harvestedAt: new Date(),
          actualYieldKg: weightKg,
          actualRevenue: revenue,
          actualCost: totalCost,
          actualProfit: profit,
          qualityGrade,
        },
      }),
    ]);

    return NextResponse.json({ id: harvest.id }, { status: 201 });
  } catch (err) {
    console.error("Harvest create error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
