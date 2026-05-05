import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.160"],
  turbopack: {}, // explicitly opt into Turbopack; silences the webpack/turbopack mismatch error
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    }
    return config;
  },
};

export default nextConfig;
