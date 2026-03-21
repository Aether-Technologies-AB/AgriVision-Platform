import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { put } from "@vercel/blob";

// File types we accept for Blob upload
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

    // Check if Vercel Blob is configured
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      // Store photo record without blob URL — just record that a photo was taken
      let analysis = null;
      if (analysisStr) {
        try { analysis = JSON.parse(analysisStr); } catch { /* ignore */ }
      }

      const photo = await prisma.photo.create({
        data: {
          zoneId,
          rgbUrl: `local://${rgbFile.name || "photo.jpg"}`,
          depthUrl: depthFile ? `local://${depthFile.name || "depth"}` : null,
          analysis,
        },
      });

      return NextResponse.json(
        { id: photo.id, warning: "BLOB_READ_WRITE_TOKEN not configured, photo stored as reference only" },
        { status: 201 }
      );
    }

    // Upload RGB file to Vercel Blob
    const timestamp = Date.now();
    let rgbUrl: string;

    try {
      const rgbBlob = await put(
        `photos/${zoneId}/${timestamp}_rgb.jpg`,
        rgbFile,
        { access: "public" }
      );
      rgbUrl = rgbBlob.url;
    } catch (uploadErr) {
      console.error("Blob RGB upload error:", uploadErr);
      return NextResponse.json(
        { error: "Failed to upload RGB image" },
        { status: 500 }
      );
    }

    // Upload depth file if provided AND it's an image type (skip .npy files)
    let depthUrl: string | null = null;
    if (depthFile) {
      const depthType = depthFile.type || "";
      const depthName = depthFile.name || "";

      if (ALLOWED_IMAGE_TYPES.has(depthType) || depthName.endsWith(".png") || depthName.endsWith(".jpg")) {
        try {
          const ext = depthName.endsWith(".png") ? "png" : "jpg";
          const depthBlob = await put(
            `photos/${zoneId}/${timestamp}_depth.${ext}`,
            depthFile,
            { access: "public" }
          );
          depthUrl = depthBlob.url;
        } catch (uploadErr) {
          console.error("Blob depth upload error (non-fatal):", uploadErr);
          // Non-fatal — continue without depth
        }
      } else {
        // Skip non-image files (.npy, etc.) — just note the filename
        console.log(`Skipping non-image depth file: ${depthName} (${depthType})`);
      }
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
        rgbUrl,
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
