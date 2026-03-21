import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function GET(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const zoneId = request.nextUrl.searchParams.get("zoneId");

    if (!zoneId) {
      return NextResponse.json(
        { error: "zoneId query parameter is required" },
        { status: 400 }
      );
    }

    // Verify zone belongs to the key's organization
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== apiKey!.organizationId) {
      return NextResponse.json(
        { error: "Zone not found or access denied" },
        { status: 403 }
      );
    }

    const commands = await prisma.command.findMany({
      where: {
        zoneId,
        status: "PENDING",
      },
      orderBy: { issuedAt: "asc" },
      select: {
        id: true,
        command: true,
        payload: true,
        issuedAt: true,
      },
    });

    return NextResponse.json({ commands });
  } catch (err) {
    console.error("Agent commands error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
