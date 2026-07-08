import { del } from "@vercel/blob";
import { prisma } from "./prisma";

const DEFAULT_KEEP = 10;

function isRealBlobUrl(url: string | null): url is string {
  return !!url && url.startsWith("http");
}

/**
 * Caps a zone's live (non-pruned) Photo rows at `keep`, most-recent-first.
 * Deletes the RGB/depth blobs for anything beyond that and marks the row
 * prunedAt — the row and its `analysis` JSON (ML training labels, batch
 * photo counts) survive; only the blob bytes are freed. Scoped entirely by
 * zoneId, so one zone's upload can never evict another zone's photos.
 *
 * Safe to call on every upload: it re-derives "current excess" fresh each
 * time, so re-running (or a race between concurrent uploads) converges
 * rather than double-deleting.
 */
export async function enforcePhotoRetention(zoneId: string, keep: number = DEFAULT_KEEP) {
  const excess = await prisma.photo.findMany({
    where: { zoneId, prunedAt: null },
    orderBy: { timestamp: "desc" },
    skip: keep,
    select: { id: true, rgbUrl: true, depthUrl: true },
  });

  if (excess.length === 0) return { prunedCount: 0 };

  for (const photo of excess) {
    if (isRealBlobUrl(photo.rgbUrl)) {
      try {
        await del(photo.rgbUrl);
      } catch (err) {
        console.error(`photo-retention: failed to delete rgb blob for ${photo.id}:`, err);
      }
    }
    if (isRealBlobUrl(photo.depthUrl)) {
      try {
        await del(photo.depthUrl);
      } catch (err) {
        console.error(`photo-retention: failed to delete depth blob for ${photo.id}:`, err);
      }
    }
  }

  await prisma.photo.updateMany({
    where: { id: { in: excess.map((p) => p.id) } },
    data: { prunedAt: new Date() },
  });

  return { prunedCount: excess.length };
}
