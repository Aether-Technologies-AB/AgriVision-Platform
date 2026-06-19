/**
 * Provision the microgreens batch the Urban Seeds Pi agent expects.
 *
 * The agent is hard-coded to POST decisions with batchId="batch-20260618",
 * so we create the Batch row with that literal id (Batch.id is @default(cuid())
 * but accepts any unique string at create time). The decision route does
 *   prisma.batch.findUnique({ where: { id: batchId } })
 * and then verifies batch.zone.farm.organizationId === apiKey.organizationId,
 * so the row must live under the Urban Seeds org for the existing zone API key
 * to be accepted.
 *
 * Idempotent: re-running upserts on id.
 *
 * Usage: npx tsx scripts/20260618_create_microgreens_batch.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BATCH_ID = "batch-20260618";
const BATCH_NUMBER = "B-20260618";
const ZONE_ID = "cmomks3yh000ags9ky6t2z0hj";
const FARM_ID = "cmomks3vm0009gs9kyxd0v731";
const CROP_TYPE = "microgreens";
const STARTED_AT = new Date("2026-06-18T00:00:00.000Z");

async function main() {
  // Sanity check: zone really belongs to the farm we expect.
  const zone = await prisma.zone.findUnique({
    where: { id: ZONE_ID },
    include: { farm: { include: { organization: true } } },
  });
  if (!zone) throw new Error(`Zone ${ZONE_ID} not found`);
  if (zone.farmId !== FARM_ID) {
    throw new Error(
      `Zone ${ZONE_ID} belongs to farm ${zone.farmId}, not ${FARM_ID}`,
    );
  }
  console.log(
    `Target: zone "${zone.name}" / farm "${zone.farm.name}" / org "${zone.farm.organization.name}" (${zone.farm.organizationId})`,
  );

  const batch = await prisma.batch.upsert({
    where: { id: BATCH_ID },
    update: {
      // Idempotent: leave existing values alone, just confirm the row exists.
    },
    create: {
      id: BATCH_ID,
      batchNumber: BATCH_NUMBER,
      zoneId: ZONE_ID,
      cropType: CROP_TYPE,
      substrate: "soil",
      bagCount: 1,
      phase: "COLONIZATION",
      plantedAt: STARTED_AT,
    },
  });

  console.log(
    `Batch upserted: id=${batch.id} batchNumber=${batch.batchNumber} cropType=${batch.cropType} phase=${batch.phase} plantedAt=${batch.plantedAt?.toISOString()}`,
  );

  // Verify the decision route's check will succeed.
  const check = await prisma.batch.findUnique({
    where: { id: BATCH_ID },
    include: { zone: { include: { farm: true } } },
  });
  if (!check) throw new Error("Post-create lookup failed");
  console.log(
    `Decision-route validation will pass for any API key in org ${check.zone.farm.organizationId}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
