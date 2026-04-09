/**
 * One-time script to upload an ONNX model to Vercel Blob.
 *
 * Usage:
 *   npx tsx scripts/upload-model.ts contamination_v1.onnx models/oyster/contamination_v1.onnx
 *
 * Requires BLOB_READ_WRITE_TOKEN in .env or environment.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { put } from "@vercel/blob";
import { readFileSync } from "fs";

async function main() {
  const [localPath, blobPath] = process.argv.slice(2);

  if (!localPath || !blobPath) {
    console.error(
      "Usage: npx tsx scripts/upload-model.ts <local-file> <blob-path>"
    );
    console.error(
      "Example: npx tsx scripts/upload-model.ts contamination_v1.onnx models/oyster/contamination_v1.onnx"
    );
    process.exit(1);
  }

  const buffer = readFileSync(localPath);

  const blob = await put(blobPath, buffer, {
    access: "public",
    addRandomSuffix: false,
  });

  console.log("Uploaded:", blob.url);
  console.log("Size:", (buffer.length / 1024 / 1024).toFixed(1), "MB");
  console.log("\nUse this URL in the MLModel.fileUrl when registering the model.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
