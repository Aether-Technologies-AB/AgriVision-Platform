/**
 * Tear down the disposable QA fixture created by
 * scripts/20260713_create_inference_worker_fixture.ts (org "AgriVision QA",
 * slug "agrivision-qa-inference-worker").
 *
 * Deletes bottom-up to respect FK constraints (Photo/Batch/ApiKey -> Zone ->
 * Farm -> Organization), and deletes the two uploaded Blob files. No other
 * org/farm/zone/batch is touched — everything is scoped by this org's id,
 * resolved by slug.
 *
 * Usage:
 *   npx tsx scripts/20260713_teardown_inference_worker_fixture.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { del } from "@vercel/blob";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ORG_SLUG = "agrivision-qa-inference-worker";

async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    include: { farms: { include: { zones: true } } },
  });

  if (!org) {
    console.log(`No org with slug "${ORG_SLUG}" — nothing to tear down.`);
    await prisma.$disconnect();
    return;
  }

  const zoneIds = org.farms.flatMap((f) => f.zones.map((z) => z.id));
  const farmIds = org.farms.map((f) => f.id);

  // 1. Photos (and their Blob files) in these zones.
  const photos = await prisma.photo.findMany({
    where: { zoneId: { in: zoneIds } },
    select: { id: true, rgbUrl: true, depthUrl: true },
  });
  for (const photo of photos) {
    for (const url of [photo.rgbUrl, photo.depthUrl]) {
      if (url && url.startsWith("http")) {
        try {
          await del(url);
        } catch (err) {
          console.error(`  could not delete blob ${url}:`, err);
        }
      }
    }
  }
  const deletedPhotos = await prisma.photo.deleteMany({ where: { zoneId: { in: zoneIds } } });
  console.log(`Deleted ${deletedPhotos.count} photo row(s) + their blobs`);

  // 2. Batches.
  const deletedBatches = await prisma.batch.deleteMany({ where: { zoneId: { in: zoneIds } } });
  console.log(`Deleted ${deletedBatches.count} batch(es)`);

  // 3. API keys.
  const deletedKeys = await prisma.apiKey.deleteMany({ where: { organizationId: org.id } });
  console.log(`Deleted ${deletedKeys.count} api key(s)`);

  // 4. Zones.
  const deletedZones = await prisma.zone.deleteMany({ where: { farmId: { in: farmIds } } });
  console.log(`Deleted ${deletedZones.count} zone(s)`);

  // 5. Farms.
  const deletedFarms = await prisma.farm.deleteMany({ where: { organizationId: org.id } });
  console.log(`Deleted ${deletedFarms.count} farm(s)`);

  // 6. Org.
  await prisma.organization.delete({ where: { id: org.id } });
  console.log(`Deleted org "${org.name}" (${org.id})`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
