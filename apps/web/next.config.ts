import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ev/contracts', '@ev/domain'],
};

export default nextConfig;
