import type { NextConfig } from 'next';

// 빌드/기동 시 환경변수를 zod로 먼저 검증한다 (실패 시 즉시 중단).
import './src/env';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
