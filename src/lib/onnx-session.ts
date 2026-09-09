// Shared ONNX Runtime session loader for the ML inference routes.
//
// Extracted verbatim from src/app/api/ml/predict/route.ts (2026-09-09) so that
// /api/ml/segment can reuse the identical Blob-fetch + WASM-init + cache path
// without a second copy drifting from it. The behaviour is unchanged: same
// cache key, same wasm binary, same single-threaded non-proxied config.
//
// The cache is module-level, so it persists across warm invocations of a given
// serverless instance and is shared by every route that imports this module.

import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCache = new Map<string, any>();

export async function getOrLoadSession(modelName: string, fileUrl: string) {
  const cacheKey = `${modelName}_${fileUrl}`;

  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey)!;
  }

  // Download model as ArrayBuffer (onnxruntime-web doesn't use filesystem)
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download model from ${fileUrl}: ${response.status}`
    );
  }
  const modelBuffer = await response.arrayBuffer();

  const ort = await import("onnxruntime-web");

  // Load WASM binary from the bundled node_modules file
  // Node.js ESM loader can't fetch from https:// and Vercel doesn't bundle .wasm
  const wasmPath = join(
    process.cwd(),
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"
  );
  ort.env.wasm.wasmBinary = readFileSync(wasmPath).buffer;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  const session = await ort.InferenceSession.create(
    new Uint8Array(modelBuffer)
  );
  sessionCache.set(cacheKey, session);
  return session;
}
