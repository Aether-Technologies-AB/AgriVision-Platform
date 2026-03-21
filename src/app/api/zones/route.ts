import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const zones = await prisma.zone.findMany({
      where: {
        farm: { organizationId: session.user.organizationId },
      },
      select: {
        id: true,
        name: true,
        agentStatus: true,
        currentPhase: true,
        farm: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ zones });
  } catch (err) {
    console.error("Zones list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
