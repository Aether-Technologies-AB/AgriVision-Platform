import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generateApiKey } from "@/lib/api-key";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: session.user.organizationId },
      select: {
        id: true,
        name: true,
        prefix: true,
        farmId: true,
        farm: { select: { name: true } },
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ keys });
  } catch (err) {
    console.error("API keys list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, farmId } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Verify farm belongs to org if provided
    if (farmId) {
      const farm = await prisma.farm.findUnique({ where: { id: farmId } });
      if (!farm || farm.organizationId !== session.user.organizationId) {
        return NextResponse.json({ error: "Farm not found" }, { status: 404 });
      }
    }

    const { key, keyHash, prefix } = generateApiKey();

    await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        prefix,
        organizationId: session.user.organizationId,
        farmId: farmId || null,
      },
    });

    // Return the full key ONCE
    return NextResponse.json({ key, prefix }, { status: 201 });
  } catch (err) {
    console.error("API key create error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
