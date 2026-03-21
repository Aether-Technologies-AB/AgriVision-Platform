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
    const body = await request.json();

    const zone = await prisma.zone.findUnique({
      where: { id },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    const updated = await prisma.zone.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.cameraType !== undefined && { cameraType: body.cameraType }),
        ...(body.sensorUrl !== undefined && { sensorUrl: body.sensorUrl }),
        ...(body.plugIds !== undefined && { plugIds: body.plugIds }),
      },
    });

    return NextResponse.json({ id: updated.id, name: updated.name });
  } catch (err) {
    console.error("Zone update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const zone = await prisma.zone.findUnique({
      where: { id },
      include: {
        farm: true,
        batches: {
          where: { phase: { in: ["COLONIZATION", "FRUITING", "READY_TO_HARVEST"] } },
        },
      },
    });

    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    if (zone.batches.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete zone with active batches" },
        { status: 409 }
      );
    }

    await prisma.zone.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Zone delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
