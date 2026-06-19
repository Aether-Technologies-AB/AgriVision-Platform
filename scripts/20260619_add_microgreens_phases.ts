/**
 * Extend BatchPhase enum with microgreens lifecycle values.
 *
 * Using ALTER TYPE ADD VALUE directly (not `prisma db push`) because the
 * database also contains an unrelated `playing_with_neon` sample table; a
 * full schema diff would propose dropping it.  ADD VALUE is idempotent
 * (IF NOT EXISTS) and touches only the enum.
 *
 * After this runs, `npx prisma generate` picks up the new TS enum literals
 * from schema.prisma.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { Client } from "pg";

const NEW_VALUES = [
  "GERMINATION",
  "POST_GERMINATION",
  "ACTIVE_GROWING",
  "PRE_HARVEST",
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const v of NEW_VALUES) {
      // ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction
      // block, so we issue each as its own autocommit statement.
      await client.query(`ALTER TYPE "BatchPhase" ADD VALUE IF NOT EXISTS '${v}'`);
      console.log(`ensured BatchPhase value: ${v}`);
    }
    const { rows } = await client.query(
      `SELECT unnest(enum_range(NULL::"BatchPhase")) AS value`,
    );
    console.log("Current BatchPhase values:", rows.map((r: { value: string }) => r.value).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
