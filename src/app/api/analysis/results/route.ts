import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { photoId, status, modelVersion, analysis, error: detectionError } =
      await request.json();

    if (!photoId || (status !== "ok" && status !== "failed")) {
      return NextResponse.json(
        { error: "photoId and status ('ok' or 'failed') are required" },
        { status: 400 }
      );
    }

    // Verify the photo belongs to the key's organization — mirrors the
    // tenancy check in /api/agent/photo.
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      include: { zone: { include: { farm: true } } },
    });

    if (!photo || photo.zone.farm.organizationId !== apiKey!.organizationId) {
      return NextResponse.json(
        { error: "Photo not found or access denied" },
        { status: 403 }
      );
    }

    // Merge under `detection` so existing Pi metrics + depth_scale_m already
    // stored in `analysis` are preserved. Re-posting the same photoId
    // overwrites the previous detection result (idempotent).
    const existingAnalysis =
      (photo.analysis as Record<string, unknown> | null) ?? {};

    const detectionPayload =
      status === "ok" ? (analysis ?? null) : { error: detectionError ?? "unknown error" };

    const mergedAnalysis = {
      ...existingAnalysis,
      detection: detectionPayload,
      modelVersion: modelVersion ?? null,
      analyzedBy: "worker",
    };

    const updated = await prisma.photo.update({
      where: { id: photoId },
      data: {
        analysis: mergedAnalysis,
        // Set on both ok and failed — a bad image must not be re-pulled forever.
        analyzedAt: new Date(),
      },
    });

    return NextResponse.json({ id: updated.id, analyzedAt: updated.analyzedAt });
  } catch (err) {
    console.error("Analysis results error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
