import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { status } = await request.json();

    if (!status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    const event = await prisma.scheduleEvent.findUnique({
      where: { id },
      include: { batch: { include: { zone: { include: { farm: true } } } } },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Verify ownership via batch or allow org-level events
    if (event.batch && event.batch.zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const updated = await prisma.scheduleEvent.update({
      where: { id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : undefined,
      },
    });

    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err) {
    console.error("Schedule update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
