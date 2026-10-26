import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@x-harness/shared'],
  webpack: (config) => { if (process.env.HARNESS_NO_BUILD_CACHE) config.cache = false; return config },
  images: { unoptimized: true },
};

export default nextConfig;
