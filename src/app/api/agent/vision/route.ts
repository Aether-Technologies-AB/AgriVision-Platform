import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { zoneId, analysis } = await request.json();

    if (!zoneId || !analysis) {
      return NextResponse.json(
        { error: "zoneId and analysis are required" },
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

    // Create photo record with ML analysis (no image file — just analysis data)
    const photo = await prisma.photo.create({
      data: {
        zoneId,
        rgbUrl: "", // Vision endpoint stores analysis only; photo endpoint handles files
        analysis,
      },
    });

    return NextResponse.json({ id: photo.id }, { status: 201 });
  } catch (err) {
    console.error("Agent vision error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
