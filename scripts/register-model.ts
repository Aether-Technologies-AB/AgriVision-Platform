/**
 * Register an ONNX model in the MLModel database table.
 *
 * Usage:
 *   npx tsx scripts/register-model.ts
 *
 * Edit the data below before running. Requires DATABASE_URL in .env.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const model = await prisma.mLModel.create({
    data: {
      name: "contamination",
      version: "1.0.0",
      cropType: "oyster",
      fileUrl: "https://igigqhuyo7zl7pbl.public.blob.vercel-storage.com/contamination_v1.onnx",
      fileSizeMb: 15.3,
      accuracy: 0.974,
      trainedOn: "2026-04-08",
      epochs: 30,
      isActive: true,
    },
  });

  console.log("Registered model:", model.id);
  console.log("  Name:", model.name);
  console.log("  Version:", model.version);
  console.log("  Crop:", model.cropType);
  console.log("  Active:", model.isActive);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
