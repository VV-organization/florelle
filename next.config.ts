import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function config(phase: string): NextConfig {
  const pages = phase !== PHASE_DEVELOPMENT_SERVER && process.env.BUILD_TARGET !== 'server';
  const basePath = pages ? '/florelle' : '';
  return {
    output: pages ? 'export' : 'standalone',
    basePath,
    // basePath also prefixes _next assets; a separate CDN assetPrefix is unnecessary.
    trailingSlash: pages,
    // UI routes are .tsx; Node/SQLite API handlers are .ts and stay server-only.
    pageExtensions: pages ? ['tsx'] : ['tsx', 'ts'],
    images: { unoptimized: pages },
    env: {
      NEXT_PUBLIC_STATIC_STOREFRONT: pages ? 'true' : 'false',
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
    outputFileTracingExcludes: {'/*': ['./data/**/*', './.env*', './out/**/*']},
    poweredByHeader: false,
    devIndicators: false,
  };
}
