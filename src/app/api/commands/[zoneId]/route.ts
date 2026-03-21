import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { zoneId } = await params;
    const { command, payload } = await request.json();

    if (!command) {
      return NextResponse.json(
        { error: "command is required" },
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
        { error: "Zone not found" },
        { status: 404 }
      );
    }

    const cmd = await prisma.command.create({
      data: {
        zoneId,
        command,
        payload: payload ?? null,
      },
    });

    return NextResponse.json({ id: cmd.id }, { status: 201 });
  } catch (err) {
    console.error("Command create error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
