import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['sharp', 'onnxruntime-web'],
  outputFileTracingIncludes: {
    '/api/ml/predict': ['./node_modules/onnxruntime-web/dist/**/*'],
    // Same reason as /api/ml/predict: the ORT WASM binary is read off disk at
    // runtime (see src/lib/onnx-session.ts) and Vercel will not trace it on
    // its own, so the segment route needs its own entry or it 500s in prod.
    '/api/ml/segment': ['./node_modules/onnxruntime-web/dist/**/*'],
  },
  images: {
    remotePatterns: [
      { hostname: "placehold.co" },
      { hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
