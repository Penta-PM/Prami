import type { NextConfig } from 'next';

// 빌드/기동 시 환경변수를 zod로 먼저 검증한다 (실패 시 즉시 중단).
import './src/env';

const nextConfig: NextConfig = {
  // E2E 는 같은 워크트리에서 도는 개발 서버(.next)와 잠금·캐시가 겹치지 않도록 별도 폴더를 쓴다
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // PGlite 는 wasm·데이터 파일을 런타임에 읽으므로 번들하지 않는다
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
  // 개발 도구 배지가 접힌 사이드바 하단 버튼을 가리므로 끈다 (오류 오버레이는 그대로 동작)
  devIndicators: false,
};

export default nextConfig;
