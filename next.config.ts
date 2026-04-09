import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['sharp', 'onnxruntime-web'],
  outputFileTracingIncludes: {
    '/api/ml/predict': ['./node_modules/onnxruntime-web/dist/**/*'],
  },
  images: {
    remotePatterns: [
      { hostname: "placehold.co" },
      { hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
