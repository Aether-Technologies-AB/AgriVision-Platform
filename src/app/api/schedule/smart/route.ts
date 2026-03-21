import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { callClaude } from "@/lib/claude";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { deliveryDate, quantityKg, cropType, customerName } = await request.json();

    if (!deliveryDate || !quantityKg || !cropType) {
      return NextResponse.json(
        { error: "deliveryDate, quantityKg, and cropType are required" },
        { status: 400 }
      );
    }

    const orgId = session.user.organizationId;

    // Gather historical data for Claude
    const [completedBatches, zones] = await Promise.all([
      prisma.batch.findMany({
        where: {
          zone: { farm: { organizationId: orgId } },
          phase: "HARVESTED",
          cropType: { contains: cropType.split("_")[0] }, // Match crop family
        },
        include: {
          harvests: { take: 1 },
          zone: { select: { name: true } },
        },
        orderBy: { harvestedAt: "desc" },
        take: 20,
      }),
      prisma.zone.findMany({
        where: { farm: { organizationId: orgId } },
        include: {
          batches: {
            where: { phase: { in: ["COLONIZATION", "FRUITING", "READY_TO_HARVEST", "PLANNED"] } },
            select: { batchNumber: true, phase: true, estHarvestDate: true },
          },
        },
      }),
    ]);

    // Calculate averages
    const cycleTimes = completedBatches
      .filter((b: any) => b.plantedAt && b.harvestedAt)
      .map((b: any) => Math.floor((b.harvestedAt!.getTime() - b.plantedAt!.getTime()) / (1000 * 60 * 60 * 24)));
    const avgCycleTime = cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a: any, b: any) => a + b, 0) / cycleTimes.length) : 28;

    const yields = completedBatches.filter((b: any) => b.actualYieldKg && b.bagCount);
    const avgYieldPerBag = yields.length > 0
      ? yields.reduce((s: any, b: any) => s + (b.actualYieldKg! / b.bagCount), 0) / yields.length
      : 0.5;

    const zonesSummary = zones.map((z: any) => ({
      name: z.name,
      activeBatches: z.batches.map((b: any) => `${b.batchNumber} (${b.phase}, est. harvest: ${b.estHarvestDate ? new Date(b.estHarvestDate).toISOString().slice(0, 10) : "unknown"})`),
    }));

    const systemPrompt = `You are AgriVision AI's production scheduler. Given a delivery request, calculate the optimal planting plan.

Historical data:
- Average cycle time for ${cropType}: ${avgCycleTime} days (from ${cycleTimes.length} completed batches)
- Average yield per bag: ${avgYieldPerBag.toFixed(2)} kg
- Completed batches: ${completedBatches.length}

Available zones:
${zonesSummary.map((z: any) => `- ${z.name}: ${z.activeBatches.length > 0 ? z.activeBatches.join(", ") : "Available"}`).join("\n")}

Today's date: ${new Date().toISOString().slice(0, 10)}

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "plantDate": "YYYY-MM-DD",
  "zone": "Zone Name",
  "bagCount": number,
  "estHarvestDate": "YYYY-MM-DD",
  "bufferDays": number,
  "confidence": number (0-1),
  "reasoning": "string explanation"
}`;

    const userMsg = `Plan production for delivery:
- Delivery date: ${deliveryDate}
- Quantity needed: ${quantityKg} kg
- Crop type: ${cropType}
${customerName ? `- Customer: ${customerName}` : ""}

Calculate the planting date, zone, and bag count needed.`;

    const response = await callClaude({
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 1000,
    });

    // Parse JSON from response
    let plan;
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      plan = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(response);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: response },
        { status: 500 }
      );
    }

    return NextResponse.json({ plan });
  } catch (err) {
    console.error("Smart scheduler error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
