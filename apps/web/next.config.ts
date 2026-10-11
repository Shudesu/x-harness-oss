import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  webpack: (config) => { if (process.env.HARNESS_NO_BUILD_CACHE) config.cache = false; return config },
  images: { unoptimized: true },
};

export default nextConfig;
