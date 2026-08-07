import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ['@ev/contracts', '@ev/domain'],
};

export default nextConfig;
