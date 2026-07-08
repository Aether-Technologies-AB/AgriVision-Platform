/**
 * One-time backfill: cap every zone's live Photo blobs at the retention
 * limit (10, see src/lib/photo-retention.ts) to immediately free Vercel Blob
 * quota, rather than waiting for the ongoing per-upload cap to trickle down
 * naturally over future uploads.
 *
 * Run only after confirming a raw-image backup exists for any zone whose
 * photos matter beyond the surviving `analysis` JSON (Mushu Colonization —
 * see scripts/20260707_download_mushu_colonization_photos.ts). All other
 * zones rely on `analysis` JSON survival only, per explicit sign-off.
 *
 * Usage:
 *   npx tsx scripts/20260707_backfill_photo_retention.ts
 *
 * Requires DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local or .env.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

// NOTE: enforcePhotoRetention is loaded via dynamic import() inside main(),
// deliberately NOT as a static top-level import. TypeScript's CommonJS
// output hoists all static `import`-derived require() calls above other
// top-level statements (including the config() calls above) — so a static
// import here would make src/lib/prisma.ts's singleton construct itself
// before DATABASE_URL is loaded, causing ECONNREFUSED. Dynamic import()
// runs exactly where it's written, after config() has already populated
// process.env.

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const { enforcePhotoRetention } = await import("../src/lib/photo-retention");

  const zones = await prisma.zone.findMany({
    select: { id: true, name: true, farm: { select: { name: true } } },
  });

  console.log(`Backfilling photo retention across ${zones.length} zones (keep = 10 each)...\n`);

  let totalPruned = 0;
  for (const zone of zones) {
    const { prunedCount } = await enforcePhotoRetention(zone.id);
    if (prunedCount > 0) {
      console.log(`  ${zone.farm.name} / ${zone.name}: pruned ${prunedCount}`);
    }
    totalPruned += prunedCount;
  }

  console.log(`\nTotal rows pruned (blobs deleted, DB rows kept + marked prunedAt): ${totalPruned}`);
  await prisma.$disconnect();
  // The dynamically-imported shared singleton (used inside enforcePhotoRetention)
  // holds its own pg pool open; force-exit rather than track it down separately.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
