import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {'/*': ['./data/**/*', './.env*']},
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
