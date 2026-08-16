import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ['@ev/contracts', '@ev/domain'],
  ...(process.env.EV_NEXT_DIST_DIR ? { distDir: process.env.EV_NEXT_DIST_DIR } : {}),
};

export default nextConfig;
