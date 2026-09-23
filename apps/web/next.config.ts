import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/lib/web-security.ts';

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ['@ev/contracts', '@ev/domain'],
  async headers() {
    return [{ source: '/(.*)', headers: staticSecurityHeaders() }];
  },
  ...(process.env.EV_NEXT_DIST_DIR ? { distDir: process.env.EV_NEXT_DIST_DIR } : {}),
};

export default nextConfig;
