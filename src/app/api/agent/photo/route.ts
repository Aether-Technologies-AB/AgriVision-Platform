import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { put } from "@vercel/blob";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const zoneId = formData.get("zoneId") as string;
    const rgbFile = formData.get("rgb") as File | null;
    const depthFile = formData.get("depth") as File | null;
    const analysisStr = formData.get("analysis") as string | null;

    if (!zoneId || !rgbFile) {
      return NextResponse.json(
        { error: "zoneId and rgb file are required" },
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

    // Upload RGB file to Vercel Blob
    const timestamp = Date.now();
    const rgbBlob = await put(
      `photos/${zoneId}/${timestamp}_rgb.jpg`,
      rgbFile,
      { access: "public" }
    );

    // Upload depth file if provided
    let depthUrl: string | null = null;
    if (depthFile) {
      const depthBlob = await put(
        `photos/${zoneId}/${timestamp}_depth.png`,
        depthFile,
        { access: "public" }
      );
      depthUrl = depthBlob.url;
    }

    // Parse analysis JSON if provided
    let analysis = null;
    if (analysisStr) {
      try {
        analysis = JSON.parse(analysisStr);
      } catch {
        return NextResponse.json(
          { error: "Invalid analysis JSON" },
          { status: 400 }
        );
      }
    }

    const photo = await prisma.photo.create({
      data: {
        zoneId,
        rgbUrl: rgbBlob.url,
        depthUrl,
        analysis,
      },
    });

    return NextResponse.json({ id: photo.id }, { status: 201 });
  } catch (err) {
    console.error("Agent photo error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
