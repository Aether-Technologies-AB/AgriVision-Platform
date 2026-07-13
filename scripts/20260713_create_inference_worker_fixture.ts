/**
 * Provision a disposable QA tenant for testing the inference-worker contract
 * (GET /api/analysis/pending, POST /api/analysis/results) end-to-end against
 * real DB rows and real Blob-hosted images, without touching Mushu/Urban
 * Seeds production data.
 *
 * Creates: org "AgriVision QA" / farm / zone / one MICROGREEN batch
 * (cropType="lettuce") / a farm-scoped API key / two Photo rows:
 *   - a real RGB JPEG + real 16-bit-depth PNG (both freshly generated and
 *     uploaded to Blob) — exercises the ok/happy path
 *   - a Photo whose rgbUrl 404s — exercises the failed path
 *
 * Idempotent-ish: re-running finds the existing org/farm/zone/batch by name
 * and skips re-creating them, but always creates a new API key (plaintext
 * can't be re-printed) and new Photo rows (each run's photos are fresh
 * "unanalyzed" fixtures).
 *
 * This is throwaway QA data — delete the org (cascades) when done testing.
 *
 * Usage:
 *   npx tsx scripts/20260713_create_inference_worker_fixture.ts
 *
 * Requires DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local or .env.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "crypto";
import { put } from "@vercel/blob";
import sharp from "sharp";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ORG_NAME = "AgriVision QA";
const ORG_SLUG = "agrivision-qa-inference-worker";
const FARM_NAME = "QA Rail Test Facility";
const ZONE_NAME = "QA Rail Zone A";
const BATCH_NUMBER_PREFIX = "QA-LETTUCE";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): { key: string; keyHash: string; prefix: string } {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let key = "agv_";
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, 8) };
}

// A tiny but real 16-bit grayscale PNG, e.g. a synthetic depth ramp — real
// enough to prove the worker's "I;16, no downcast" decode path against
// genuine 16-bit pixel data (not an 8-bit placeholder pretending to be depth).
async function makeDepthPng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Ramp 0..60000 so it's obviously not an 8-bit-range value.
      const value = Math.floor((x / width) * 60000);
      const idx = (y * width + x) * 2;
      raw.writeUInt16BE(value, idx); // sharp raw->png for 16-bit expects big-endian
    }
  }
  return sharp(raw, { raw: { width, height, channels: 1, premultiplied: false, depth: "ushort" } })
    .png()
    .toBuffer();
}

async function makeRgbJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 60, g: 140, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function main() {
  // 1. Org (upsert by slug).
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME },
    create: { name: ORG_NAME, slug: ORG_SLUG, plan: "STARTER" },
  });
  console.log(`Org: "${org.name}" (id: ${org.id})`);

  // 2. Farm.
  let farm = await prisma.farm.findFirst({ where: { organizationId: org.id, name: FARM_NAME } });
  if (!farm) {
    farm = await prisma.farm.create({
      data: { name: FARM_NAME, address: "QA fixture — no physical address", timezone: "Europe/Stockholm", organizationId: org.id },
    });
    console.log(`  created farm: "${farm.name}" (id: ${farm.id})`);
  } else {
    console.log(`  farm exists: "${farm.name}" (id: ${farm.id})`);
  }

  // 3. Zone.
  let zone = await prisma.zone.findFirst({ where: { farmId: farm.id, name: ZONE_NAME } });
  if (!zone) {
    zone = await prisma.zone.create({
      data: { name: ZONE_NAME, farmId: farm.id, cameraType: "realsense_d435", agentStatus: "OFFLINE", currentPhase: "IDLE", autoMode: false },
    });
    console.log(`  created zone: "${zone.name}" (id: ${zone.id})`);
  } else {
    console.log(`  zone exists: "${zone.name}" (id: ${zone.id})`);
  }

  // 4. Batch — cropType "lettuce", MICROGREEN family.
  let batch = await prisma.batch.findFirst({ where: { zoneId: zone.id, cropType: "lettuce" } });
  if (!batch) {
    const batchNumber = `${BATCH_NUMBER_PREFIX}-${Date.now()}`;
    batch = await prisma.batch.create({
      data: {
        batchNumber,
        zoneId: zone.id,
        cropFamily: "MICROGREEN",
        cropType: "lettuce",
        trayCount: 4,
        seedingDensityGSqm: 25,
        growthDay: 10,
        phase: "ACTIVE_GROWING",
        plantedAt: new Date(),
      },
    });
    console.log(`  created batch: ${batch.batchNumber} (id: ${batch.id})`);
  } else {
    console.log(`  batch exists: ${batch.batchNumber} (id: ${batch.id})`);
  }

  // 5. API key (farm-scoped). Plaintext can't be re-printed, so on rerun we
  // delete the old fixture key and mint a fresh one rather than piling up
  // stray unusable keys.
  await prisma.apiKey.deleteMany({ where: { organizationId: org.id, farmId: farm.id, name: "Inference Worker QA" } });
  const { key, keyHash, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: { name: "Inference Worker QA", keyHash, prefix, organizationId: org.id, farmId: farm.id },
  });
  console.log(`  created api key (id: ${apiKey.id}, prefix: ${prefix})`);

  // 6. Real RGB + depth images, uploaded to Blob.
  const rgbBuf = await makeRgbJpeg(320, 240);
  const depthBuf = await makeDepthPng(320, 240);

  const rgbBlob = await put(`photos/${zone.id}/qa-fixture-rgb.jpg`, rgbBuf, {
    access: "public",
    contentType: "image/jpeg",
    allowOverwrite: true,
  });
  const depthBlob = await put(`photos/${zone.id}/qa-fixture-depth.png`, depthBuf, {
    access: "public",
    contentType: "image/png",
    allowOverwrite: true,
  });
  console.log(`  uploaded rgb: ${rgbBlob.url}`);
  console.log(`  uploaded depth: ${depthBlob.url}`);

  // 7. Photo rows: one good (ok path), one broken rgbUrl (failed path).
  const goodPhoto = await prisma.photo.create({
    data: { zoneId: zone.id, batchId: batch.id, rgbUrl: rgbBlob.url, depthUrl: depthBlob.url },
  });
  console.log(`  created good photo: ${goodPhoto.id}`);

  const badPhoto = await prisma.photo.create({
    data: {
      zoneId: zone.id,
      batchId: batch.id,
      rgbUrl: `${rgbBlob.url}.does-not-exist-404`,
    },
  });
  console.log(`  created bad (404) photo: ${badPhoto.id}`);

  console.log("\n=== Worker env for testing ===");
  console.log(`WORKER_API_KEY=${key}`);
  console.log(`WORKER_CROP_TYPES=lettuce`);
  console.log(`\nQA org id (for cleanup): ${org.id}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
