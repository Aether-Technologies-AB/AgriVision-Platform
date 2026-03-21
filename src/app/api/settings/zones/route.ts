import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, cameraType, sensorUrl, plugIds } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const farm = await prisma.farm.findFirst({
      where: { organizationId: session.user.organizationId },
    });

    if (!farm) {
      return NextResponse.json({ error: "No farm found" }, { status: 404 });
    }

    const zone = await prisma.zone.create({
      data: {
        name,
        farmId: farm.id,
        cameraType: cameraType || null,
        sensorUrl: sensorUrl || null,
        plugIds: plugIds || null,
      },
    });

    return NextResponse.json({ id: zone.id, name: zone.name }, { status: 201 });
  } catch (err) {
    console.error("Zone create error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
