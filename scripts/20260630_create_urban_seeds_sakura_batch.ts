/**
 * Create the Urban Seeds sakura-radish pilot batch (sakura-001).
 *
 * Resolves the Urban Seeds zone dynamically — looks up the org via the
 * existing anchor user giancarlo+urbanseeds@mushu.se, then finds the single
 * Urban Seeds farm and the zone the pi4-002 agent pushes to (the only zone
 * under that farm). No hard-coded zone ID.
 *
 * Phase = GERMINATION (the earliest microgreens stage in the BatchPhase enum;
 * Phase 1 in the agent's 1-4 microgreens integer mapping).
 *
 * Idempotent: upserts on batchNumber so re-running just confirms the row
 * exists and leaves dashboard-edited fields alone.
 *
 * Usage: npx tsx scripts/20260630_create_urban_seeds_sakura_batch.ts
 *
 * Requires DATABASE_URL in .env.local or .env.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ANCHOR_USER_EMAIL = "giancarlo+urbanseeds@mushu.se";
const BATCH_NUMBER = "sakura-001";
const CROP_TYPE = "sakura-radish";
const SUBSTRATE = "microgreen mat";
const BAG_COUNT = 1;

async function main() {
  const anchor = await prisma.user.findUnique({
    where: { email: ANCHOR_USER_EMAIL },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!anchor) {
    throw new Error(
      `Anchor user ${ANCHOR_USER_EMAIL} not found — cannot resolve Urban Seeds org.`,
    );
  }
  const orgId = anchor.organization.id;
  console.log(
    `Org: "${anchor.organization.name}" (id: ${orgId})`,
  );

  const farms = await prisma.farm.findMany({
    where: { organizationId: orgId },
    include: { zones: true },
  });
  if (farms.length !== 1) {
    throw new Error(
      `Expected exactly 1 farm under Urban Seeds, found ${farms.length}. Resolve manually.`,
    );
  }
  const farm = farms[0];
  if (farm.zones.length !== 1) {
    throw new Error(
      `Expected exactly 1 zone under "${farm.name}", found ${farm.zones.length}. ` +
        `Resolve manually — pi4-002 should be the only Pi pushing to this farm.`,
    );
  }
  const zone = farm.zones[0];
  console.log(`Farm: "${farm.name}" (id: ${farm.id})`);
  console.log(`Zone: "${zone.name}" (id: ${zone.id})`);

  const plantedAt = new Date();

  const batch = await prisma.batch.upsert({
    where: { batchNumber: BATCH_NUMBER },
    update: {
      // Re-runs: keep existing values, just confirm the row.
    },
    create: {
      batchNumber: BATCH_NUMBER,
      zoneId: zone.id,
      cropType: CROP_TYPE,
      substrate: SUBSTRATE,
      bagCount: BAG_COUNT,
      phase: "GERMINATION",
      plantedAt,
    },
  });

  console.log("\n========================================");
  console.log("SAKURA PILOT BATCH CREATED");
  console.log("========================================");
  console.log(`  id:          ${batch.id}`);
  console.log(`  batchNumber: ${batch.batchNumber}`);
  console.log(`  cropType:    ${batch.cropType}`);
  console.log(`  substrate:   ${batch.substrate}`);
  console.log(`  bagCount:    ${batch.bagCount}`);
  console.log(`  phase:       ${batch.phase}`);
  console.log(`  plantedAt:   ${batch.plantedAt?.toISOString()}`);
  console.log(`  zoneId:      ${batch.zoneId}`);
  console.log("========================================");
  console.log(
    "Pi agent (pi4-002) can now send batchId='" + batch.id + "' on decisions" +
      ` (or batch_number='${batch.batchNumber}' via sync.register_batch() / sync.get_batch() to look up the id).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
