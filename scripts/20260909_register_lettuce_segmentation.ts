// Registers the lettuce instance-segmentation model in MLModel.
//
// isActive is FALSE on purpose and must stay false for now: the model has never
// seen a plant older than day 16, and the imminent harvest produces the first
// mature-canopy frames it should be retrained on (see train/README.md).
// /api/ml/segment looks up `isActive: true`, so while this row is inactive the
// endpoint returns the fallback response and the edge keeps emitting
// method="gate" only — which is exactly the intended parallel-run state.
//
// ARTIFACT CHOICE — the 640 px export, not the 896 px one.
//
// Both exports are the same trained weights (runs/segment/lettuce_seg-2). The
// model trained at imgsz=896, so 896 is the faithful resolution, and it is what
// the reference numbers in NOTEBOOK.md iterations 74-75 were produced at. But
// measured through this stack — onnxruntime-web on WASM, single-threaded, which
// is what Vercel runs — 896 costs 2,295 ms end to end and 640 costs 1,163 ms
// (2,254 / 1,132 ms of that is the ONNX run; preprocessing and polygon decode
// are ~40 ms combined). CLAUDE.md sets a <2 s target for this endpoint, so 896
// misses it on a developer Mac and would miss it by more on a Vercel CPU.
//
// Accuracy is not the tradeoff it looks like. Against an ultralytics reference
// run of the 896 ONNX over 12 archived rail1 frames, the 640 export matches the
// instance count on 11 of 12 — the same score the 896 export gets through this
// stack — and on the F1-MODELS acceptance frame (2026-09-08 stop 4) both return
// exactly 11 instances, with 640's areas +1.1% against the reference.
//
// The 896 artifact is uploaded alongside it at
//   models/lettuce/segmentation_v1.onnx
// and /api/ml/segment reads its input edge from the model's own metadata, so
// switching back is this one fileUrl and no code change at all.
//
// Idempotent: unique on [name, version], so re-running updates in place.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  const { prisma } = await import("@/lib/prisma");

  const fileUrl =
    "https://igigqhuyo7zl7pbl.public.blob.vercel-storage.com/models/lettuce/segmentation_v1_640.onnx";

  const row = await prisma.mLModel.upsert({
    where: { name_version: { name: "segmentation", version: "1.0.0" } },
    create: {
      name: "segmentation",
      version: "1.0.0",
      cropType: "lettuce",
      fileUrl,
      fileSizeMb: 47.4,
      accuracy: 0.836, // mask mAP50-95 against the SAM2-derived labels
      epochs: 150,
      trainedOn: "rail1 2026-08-23..09-08, 4110 SAM2-derived polygons (trained imgsz=896, served at 640)",
      isActive: false,
    },
    update: {
      cropType: "lettuce",
      fileUrl,
      fileSizeMb: 47.4,
      accuracy: 0.836,
      epochs: 150,
      trainedOn: "rail1 2026-08-23..09-08, 4110 SAM2-derived polygons (trained imgsz=896, served at 640)",
      isActive: false,
    },
  });

  console.log(JSON.stringify(row, null, 2));
  await prisma.$disconnect();
}

main();
