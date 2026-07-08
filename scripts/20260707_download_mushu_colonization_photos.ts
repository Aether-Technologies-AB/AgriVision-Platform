/**
 * One-time raw-image backup for the Mushu Colonization zone, ahead of the
 * photo-retention backfill prune.
 *
 * Downloads every blob under `photos/<zoneId>/` (RGB + depth) from Vercel
 * Blob to a local folder, mirroring the remote pathname. Read-only against
 * Vercel Blob and the DB — nothing is deleted or modified remotely. Safe to
 * re-run: already-downloaded files with a matching byte size are skipped, so
 * an interrupted run can resume.
 *
 * At the end it cross-checks every Photo DB row's rgbUrl/depthUrl for this
 * zone against the blob listing, so you can see if anything the DB thinks
 * exists is missing from Blob (or vice versa) before you approve the prune.
 *
 * Usage:
 *   npx tsx scripts/20260707_download_mushu_colonization_photos.ts [destDir]
 *
 * destDir defaults to ~/agrivision-backups/mushu-colonization-photos.
 * Requires BLOB_READ_WRITE_TOKEN + DATABASE_URL in .env.local or .env.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { list } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { mkdirSync, existsSync, statSync, writeFileSync, createWriteStream } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { pipeline } from "stream/promises";

const ZONE_ID = "cmomks3f70003gs9klj2kn7n4"; // Mushu Colonization
const DEST_DIR = process.argv[2] || join(homedir(), "agrivision-backups", "mushu-colonization-photos");
const CONCURRENCY = 5;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface BlobEntry {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string;
}

async function listAllBlobs(prefix: string): Promise<BlobEntry[]> {
  const all: BlobEntry[] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await list({ prefix, limit: 1000, cursor });
    for (const b of res.blobs) {
      all.push({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: String(b.uploadedAt) });
    }
    if (!res.hasMore) break;
    cursor = res.cursor;
  }
  return all;
}

async function downloadOne(blob: BlobEntry): Promise<{ status: "downloaded" | "skipped" | "failed"; error?: string }> {
  const localPath = join(DEST_DIR, blob.pathname);
  mkdirSync(dirname(localPath), { recursive: true });

  if (existsSync(localPath)) {
    const existing = statSync(localPath);
    if (existing.size === blob.size) {
      return { status: "skipped" };
    }
  }

  try {
    const res = await fetch(blob.url);
    if (!res.ok || !res.body) {
      return { status: "failed", error: `HTTP ${res.status}` };
    }
    const fileStream = createWriteStream(localPath);
    // @ts-expect-error - Node's WritableStream vs web ReadableStream interop
    await pipeline(res.body, fileStream);

    const written = statSync(localPath);
    if (written.size !== blob.size) {
      return { status: "failed", error: `size mismatch: expected ${blob.size}, got ${written.size}` };
    }
    return { status: "downloaded" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  console.log(`Target zone: Mushu Colonization (${ZONE_ID})`);
  console.log(`Destination: ${DEST_DIR}\n`);

  console.log("Listing blobs under photos/" + ZONE_ID + "/ ...");
  const blobs = await listAllBlobs(`photos/${ZONE_ID}/`);
  const totalBytes = blobs.reduce((sum, b) => sum + b.size, 0);
  console.log(`Found ${blobs.length} blobs, ${(totalBytes / (1024 * 1024)).toFixed(1)} MB total.\n`);

  mkdirSync(DEST_DIR, { recursive: true });

  let downloaded = 0, skipped = 0, failed = 0;
  const failures: { pathname: string; error: string }[] = [];
  let done = 0;

  const results = await runWithConcurrency(blobs, CONCURRENCY, async (blob) => {
    const r = await downloadOne(blob);
    done++;
    if (done % 25 === 0 || done === blobs.length) {
      console.log(`  progress: ${done}/${blobs.length}`);
    }
    return { blob, r };
  });

  for (const { blob, r } of results) {
    if (r.status === "downloaded") downloaded++;
    else if (r.status === "skipped") skipped++;
    else {
      failed++;
      failures.push({ pathname: blob.pathname, error: r.error || "unknown" });
    }
  }

  console.log("\n========================================");
  console.log("DOWNLOAD SUMMARY");
  console.log("========================================");
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Already present (skipped): ${skipped}`);
  console.log(`Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.pathname}: ${f.error}`);
  }

  // Cross-check against DB Photo rows for this zone: any URL the DB thinks
  // exists that isn't in the blob listing (dangling reference), informational
  // only — does not affect what was downloaded above.
  console.log("\n=== Cross-checking DB Photo rows for this zone ===");
  const photos = await prisma.photo.findMany({
    where: { zoneId: ZONE_ID },
    select: { id: true, rgbUrl: true, depthUrl: true, timestamp: true },
  });
  const blobUrlSet = new Set(blobs.map((b) => b.url));
  const dangling: { photoId: string; url: string; kind: string }[] = [];
  for (const p of photos) {
    if (p.rgbUrl && p.rgbUrl.startsWith("http") && !blobUrlSet.has(p.rgbUrl)) {
      dangling.push({ photoId: p.id, url: p.rgbUrl, kind: "rgb" });
    }
    if (p.depthUrl && p.depthUrl.startsWith("http") && !blobUrlSet.has(p.depthUrl)) {
      dangling.push({ photoId: p.id, url: p.depthUrl, kind: "depth" });
    }
  }
  console.log(`Photo DB rows for this zone: ${photos.length}`);
  console.log(`Dangling DB references (URL not found in Blob listing): ${dangling.length}`);
  if (dangling.length) {
    console.log("(these Photo rows point at URLs that no longer/never existed in Blob — not part of this backup, flagged for awareness)");
    for (const d of dangling.slice(0, 20)) console.log(`  ${d.photoId} (${d.kind}): ${d.url}`);
    if (dangling.length > 20) console.log(`  ... and ${dangling.length - 20} more`);
  }

  // Write a manifest so completeness can be verified without re-running.
  const manifestPath = join(DEST_DIR, "_manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        zoneId: ZONE_ID,
        zoneName: "Mushu Colonization",
        generatedAt: new Date().toISOString(),
        remoteBlobCount: blobs.length,
        remoteTotalBytes: totalBytes,
        downloaded,
        skipped,
        failed,
        failures,
        dbPhotoRowCount: photos.length,
        danglingDbReferences: dangling,
        blobs: blobs.map((b) => ({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt })),
      },
      null,
      2
    )
  );
  console.log(`\nManifest written to: ${manifestPath}`);
  console.log(`\nDone. Verify local file count/size against the manifest before approving the backfill prune.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
