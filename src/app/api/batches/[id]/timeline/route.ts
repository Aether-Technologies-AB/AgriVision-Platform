import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

interface TimelineEvent {
  id: string;
  type: "decision" | "photo" | "event";
  subtype: string;
  title: string;
  detail: string | null;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = 50;

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: { zone: { include: { farm: true } } },
    });

    if (!batch || batch.zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Fetch all three types in parallel
    const cursorDate = cursor ? new Date(cursor) : undefined;
    const dateFilter = cursorDate ? { lt: cursorDate } : {};

    const [decisions, photos, events] = await Promise.all([
      prisma.aIDecision.findMany({
        where: {
          batchId: id,
          ...(cursorDate ? { timestamp: dateFilter } : {}),
        },
        orderBy: { timestamp: "desc" },
        take: limit,
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
      prisma.photo.findMany({
        where: {
          zoneId: batch.zoneId,
          ...(batch.plantedAt
            ? {
                timestamp: {
                  gte: batch.plantedAt,
                  ...(batch.harvestedAt ? { lte: batch.harvestedAt } : {}),
                  ...(cursorDate ? { lt: cursorDate } : {}),
                },
              }
            : cursorDate
              ? { timestamp: dateFilter }
              : {}),
        },
        orderBy: { timestamp: "desc" },
        take: limit,
        select: {
          id: true,
          rgbUrl: true,
          analysis: true,
          timestamp: true,
        },
      }),
      prisma.scheduleEvent.findMany({
        where: {
          batchId: id,
          ...(cursorDate ? { scheduledAt: dateFilter } : {}),
        },
        orderBy: { scheduledAt: "desc" },
        take: limit,
        select: {
          id: true,
          eventType: true,
          title: true,
          description: true,
          scheduledAt: true,
          status: true,
        },
      }),
    ]);

    // Merge and sort
    const timeline: TimelineEvent[] = [];

    for (const d of decisions as any[]) {
      timeline.push({
        id: d.id,
        type: "decision",
        subtype: d.decisionType,
        title: d.decision,
        detail: d.reasoning,
        timestamp: d.timestamp.toISOString(),
        meta: { actionTaken: d.actionTaken, costKr: d.costKr },
      });
    }

    // Deduplicate photos: Pi uploads raw + processed within seconds.
    // Keep the one with analysis data; if neither has analysis, keep the first.
    const dedupedPhotos: typeof photos = [];
    const sortedPhotos = [...(photos as any[])].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    for (const p of sortedPhotos) {
      const prev = dedupedPhotos[dedupedPhotos.length - 1];
      if (
        prev &&
        Math.abs(
          new Date(p.timestamp).getTime() - new Date(prev.timestamp).getTime()
        ) < 60_000
      ) {
        // Within 60s — keep the one with analysis
        const pHasAnalysis = !!(p.analysis as Record<string, unknown> | null);
        const prevHasAnalysis = !!(prev.analysis as Record<string, unknown> | null);
        if (pHasAnalysis && !prevHasAnalysis) {
          dedupedPhotos[dedupedPhotos.length - 1] = p;
        }
        // Otherwise keep prev (already there)
        continue;
      }
      dedupedPhotos.push(p);
    }

    for (const p of dedupedPhotos as any[]) {
      const analysis = p.analysis as Record<string, unknown> | null;
      let detail: string | null = null;
      if (analysis) {
        const count = analysis.mushroom_count;
        detail =
          count != null && Number(count) > 0
            ? `Mushrooms: ${count}`
            : "No clusters detected";
      }
      timeline.push({
        id: p.id,
        type: "photo",
        subtype: "CAPTURE",
        title: "Photo captured",
        detail,
        timestamp: p.timestamp.toISOString(),
        meta: { rgbUrl: p.rgbUrl, analysis },
      });
    }

    for (const e of events as any[]) {
      timeline.push({
        id: e.id,
        type: "event",
        subtype: e.eventType,
        title: e.title,
        detail: e.description,
        timestamp: e.scheduledAt.toISOString(),
        meta: { status: e.status },
      });
    }

    // Sort descending by timestamp
    timeline.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Trim to limit
    const page = timeline.slice(0, limit);
    const nextCursor =
      page.length === limit ? page[page.length - 1].timestamp : null;

    return NextResponse.json({ events: page, nextCursor });
  } catch (err) {
    console.error("Batch timeline error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
