import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Needed for @react-three/fiber / drei compatibility
  transpilePackages: ['three'],
};

export default nextConfig;
