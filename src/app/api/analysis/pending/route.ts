import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  const searchParams = request.nextUrl.searchParams;

  let limit = DEFAULT_LIMIT;
  const limitParam = searchParams.get("limit");
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed)) {
      limit = Math.min(Math.max(parsed, 1), MAX_LIMIT);
    }
  }

  const cropTypeParam = searchParams.get("cropType");
  const cropTypes = cropTypeParam
    ? cropTypeParam
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : null;

  try {
    const photos = await prisma.photo.findMany({
      where: {
        analyzedAt: null,
        prunedAt: null,
        rgbUrl: { startsWith: "http" },
        // Scope to the key's org (and farm, if the key is farm-scoped) — the
        // same tenancy boundary every other agent route enforces.
        zone: {
          farm: {
            organizationId: apiKey!.organizationId,
            ...(apiKey!.farmId ? { id: apiKey!.farmId } : {}),
          },
        },
        // Cross-farm/cross-crop guard: a lettuce/basil worker passes
        // cropType=lettuce,basil so it never sees Mushu/Urban Seeds photos.
        ...(cropTypes ? { batch: { cropType: { in: cropTypes } } } : {}),
      },
      include: {
        batch: { select: { cropType: true } },
      },
      orderBy: { timestamp: "asc" },
      take: limit,
    });

    const results = photos.map((photo) => ({
      photoId: photo.id,
      zoneId: photo.zoneId,
      batchId: photo.batchId,
      cropType: photo.batch?.cropType ?? null,
      rgbUrl: photo.rgbUrl,
      depthUrl: photo.depthUrl,
      timestamp: photo.timestamp,
    }));

    return NextResponse.json({ photos: results });
  } catch (err) {
    console.error("Analysis pending error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
