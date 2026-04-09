import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['onnxruntime-node', 'sharp'],
  images: {
    remotePatterns: [
      { hostname: "placehold.co" },
      { hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
