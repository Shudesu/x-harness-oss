import type { NextConfig } from 'next';
import { getBuildInfo } from '../../scripts/release/build-info.cjs';

// Release version / short commit / build date, baked into the static export
// and shown in the sidebar (see src/lib/build-info.ts).
const build = getBuildInfo() as { version: string; commit: string; builtAt: string };

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@x-harness/shared'],
  env: {
    NEXT_PUBLIC_APP_VERSION: build.version,
    NEXT_PUBLIC_BUILD_SHA: build.commit,
    NEXT_PUBLIC_BUILD_DATE: build.builtAt,
  },
  webpack: (config) => { if (process.env.HARNESS_NO_BUILD_CACHE) config.cache = false; return config },
  images: { unoptimized: true },
};

export default nextConfig;
