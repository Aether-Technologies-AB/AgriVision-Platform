import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");

    const where: Record<string, unknown> = {};

    // Filter to user's org batches or org-level events
    where.OR = [
      { batch: { zone: { farm: { organizationId: session.user.organizationId } } } },
      { batchId: null },
    ];

    if (from || to) {
      where.scheduledAt = {};
      if (from) (where.scheduledAt as Record<string, unknown>).gte = new Date(from);
      if (to) (where.scheduledAt as Record<string, unknown>).lte = new Date(to);
    }

    const events = await prisma.scheduleEvent.findMany({
      where,
      include: {
        batch: { select: { id: true, batchNumber: true, cropType: true } },
      },
      orderBy: { scheduledAt: "asc" },
    });

    return NextResponse.json({ events });
  } catch (err) {
    console.error("Schedule list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { batchId, eventType, title, description, scheduledAt } = await request.json();

    if (!eventType || !title || !scheduledAt) {
      return NextResponse.json(
        { error: "eventType, title, and scheduledAt are required" },
        { status: 400 }
      );
    }

    // If batchId provided, verify it belongs to user's org
    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { zone: { include: { farm: true } } },
      });
      if (!batch || batch.zone.farm.organizationId !== session.user.organizationId) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }
    }

    const event = await prisma.scheduleEvent.create({
      data: {
        batchId: batchId || null,
        eventType,
        title,
        description: description || null,
        scheduledAt: new Date(scheduledAt),
      },
    });

    return NextResponse.json({ id: event.id }, { status: 201 });
  } catch (err) {
    console.error("Schedule create error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
