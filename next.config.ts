import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    serverComponentsExternalPackages: ['onnxruntime-node', 'sharp'],
  },
  images: {
    remotePatterns: [
      { hostname: "placehold.co" },
      { hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
