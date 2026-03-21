import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { streamClaude } from "@/lib/claude";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { message, history, zoneId } = await request.json();

    if (!message) {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const orgId = session.user.organizationId;

    // Gather farm context in parallel
    const [org, zones, activeBatches, recentDecisions, recentPhotos, completedBatches] =
      await Promise.all([
        prisma.organization.findUnique({
          where: { id: orgId },
          include: { farms: { take: 1 } },
        }),
        prisma.zone.findMany({
          where: { farm: { organizationId: orgId } },
          include: {
            sensorReadings: { orderBy: { timestamp: "desc" }, take: 1 },
          },
        }),
        prisma.batch.findMany({
          where: {
            zone: { farm: { organizationId: orgId } },
            phase: { in: ["COLONIZATION", "FRUITING", "READY_TO_HARVEST"] },
          },
          include: { zone: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.aIDecision.findMany({
          where: { batch: { zone: { farm: { organizationId: orgId } } } },
          orderBy: { timestamp: "desc" },
          take: 5,
          select: {
            decisionType: true,
            decision: true,
            reasoning: true,
            timestamp: true,
          },
        }),
        prisma.photo.findMany({
          where: {
            zone: { farm: { organizationId: orgId } },
            analysis: { not: { equals: undefined } },
          },
          orderBy: { timestamp: "desc" },
          take: 3,
          select: { analysis: true, timestamp: true },
        }),
        prisma.batch.findMany({
          where: {
            zone: { farm: { organizationId: orgId } },
            phase: "HARVESTED",
          },
          include: { harvests: { take: 1 } },
          orderBy: { harvestedAt: "desc" },
          take: 10,
        }),
      ]);

    const farmName = org?.farms[0]?.name || "Unknown Farm";
    const orgName = org?.name || "Unknown Org";

    // Build context sections
    const zoneSummary = zones.map((z: any) => {
      const s = z.sensorReadings[0];
      return `  ${z.name}: ${z.agentStatus}${z.agentStatus === "ONLINE" ? "" : " (offline)"}, phase: ${z.currentPhase}, auto: ${z.autoMode ? "yes" : "no"}${s ? `, temp: ${s.temperature.toFixed(1)}°C, humidity: ${s.humidity.toFixed(0)}%, CO2: ${s.co2 ?? "N/A"} ppm` : ""}`;
    }).join("\n");

    const batchSummary = activeBatches.map((b: any) => {
      const day = b.plantedAt ? Math.floor((Date.now() - b.plantedAt.getTime()) / (1000 * 60 * 60 * 24)) : "?";
      return `  ${b.batchNumber} (${b.cropType}) in ${b.zone.name}: ${b.phase}, day ${day}, health ${b.healthScore ?? "?"}%, est yield ${b.estYieldKg?.toFixed(1) ?? "?"}kg`;
    }).join("\n");

    const decisionSummary = recentDecisions.map((d: any) => {
      const ago = Math.floor((Date.now() - d.timestamp.getTime()) / 3600000);
      return `  [${ago}h ago] ${d.decisionType}: ${d.decision} — ${d.reasoning.slice(0, 100)}`;
    }).join("\n");

    const visionSummary = recentPhotos.map((p: any) => {
      const a = p.analysis as Record<string, unknown> | null;
      if (!a) return "";
      return `  Count: ${a.mushroom_count ?? "?"}, Weight: ${a.estimated_weight_g ?? "?"}g, Growth: ${a.growth_rate_cm3_day ?? "?"}cm³/day`;
    }).filter(Boolean).join("\n");

    const historySummary = completedBatches.map((b: any) => {
      const h = b.harvests[0];
      const days = b.plantedAt && b.harvestedAt
        ? Math.floor((b.harvestedAt.getTime() - b.plantedAt.getTime()) / (1000 * 60 * 60 * 24))
        : "?";
      return `  ${b.batchNumber}: ${b.cropType}, ${b.actualYieldKg?.toFixed(1) ?? "?"}kg, ${b.actualProfit?.toFixed(0) ?? "?"}kr profit, ${h?.costPerGram?.toFixed(3) ?? "?"}kr/g, ${days}d`;
    }).join("\n");

    const selectedZone = zoneId ? zones.find((z: any) => z.id === zoneId) : null;

    const systemPrompt = `You are AgriVision AI, the intelligent assistant for ${orgName}'s farm "${farmName}". You help farmers monitor crops, optimize harvests, and plan production.

Current date: ${new Date().toISOString().slice(0, 10)}
User role: ${session.user.role}

ZONES:
${zoneSummary}

ACTIVE BATCHES:
${batchSummary || "  None"}

RECENT AI DECISIONS:
${decisionSummary || "  None"}

LATEST ML VISION:
${visionSummary || "  No recent scans"}

COMPLETED BATCH HISTORY:
${historySummary || "  None"}

${selectedZone ? `User is viewing: ${selectedZone.name}` : ""}

Guidelines:
- Reference specific batch numbers (e.g. B-2026-007) and real data
- Give concrete numbers: weights, profits, dates, percentages
- When discussing harvest timing, show the profit calculation
- Suggest actions the user can take in the platform (create batch, schedule event, etc.)
- Be concise but thorough. Use short paragraphs.
- If asked about something you don't have data for, say so clearly.`;

    // Build messages array with conversation history
    const messages: { role: "user" | "assistant"; content: string }[] = [];

    if (history && Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: "user", content: message });

    // Stream response
    const stream = streamClaude({
      system: systemPrompt,
      messages,
      maxTokens: 1500,
    });

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const response = await stream;
          for await (const event of response) {
            if (event.type === "content_block_delta") {
              const delta = event.delta;
              if ("text" in delta) {
                controller.enqueue(encoder.encode(delta.text));
              }
            }
          }
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
          controller.enqueue(encoder.encode("\n\n[Error: Failed to get AI response]"));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
