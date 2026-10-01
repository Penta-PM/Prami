import type { NextConfig } from 'next';

// 빌드/기동 시 환경변수를 zod로 먼저 검증한다 (실패 시 즉시 중단).
import './src/env';
import { PROXY_BODY_LIMIT_BYTES } from './src/lib/constants/upload-limits';
import { STATIC_SECURITY_HEADERS } from './src/server/security/headers';

const PGLITE_TRACE_EXCLUDES = [
  'node_modules/@electric-sql/pglite/**',
  'node_modules/.pnpm/@electric-sql+pglite*/**',
  // Turbopack 이 외부 패키지마다 <distDir>/node_modules 에 만드는 링크 (pglite-<hash>)
  '**/node_modules/@electric-sql/pglite-*',
] as const;

// 운영(neon) 빌드는 PGlite 를 자리표시 모듈로 바꿔 끼운다 — outputFileTracingExcludes 는 라우트 트레이스에만 적용되고
// proxy(middleware)·instrumentation 트레이스에는 적용되지 않아 PGlite 180파일(약 25MB)이 남았다 (PR-2 QA L-2)
const IS_NEON_BUILD = process.env.DB_DRIVER === 'neon';
const PGLITE_STUB = './src/db/pglite-unavailable.ts';
const PGLITE_MODULES = [
  '@electric-sql/pglite',
  '@electric-sql/pglite/contrib/pg_trgm',
  '@electric-sql/pglite/contrib/citext',
  '@electric-sql/pglite/contrib/pgcrypto',
] as const;

const nextConfig: NextConfig = {
  // E2E 는 같은 워크트리에서 도는 개발 서버(.next)와 잠금·캐시가 겹치지 않도록 별도 폴더를 쓴다
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // PGlite 는 wasm·데이터 파일을 런타임에 읽으므로 번들하지 않는다. @react-pdf/renderer 도 폰트 파일을 fs 로 읽는다
  serverExternalPackages: [
    ...(IS_NEON_BUILD ? [] : ['@electric-sql/pglite']),
    '@react-pdf/renderer',
  ],
  ...(IS_NEON_BUILD
    ? {
        turbopack: {
          resolveAlias: Object.fromEntries(PGLITE_MODULES.map((name) => [name, PGLITE_STUB])),
        },
      }
    : {}),
  // 견적서 PDF 가 fs 로 읽는 한글 폰트 서브셋·로고를 서버리스 번들에 포함한다 (§4.5.8, Vercel 배포 검증은 PR-11)
  outputFileTracingIncludes: {
    '/api/quotes/[id]/pdf': ['./src/assets/fonts/*.ttf', './public/logo-prami-mark.png'],
  },
  // 운영(neon) 빌드는 테스트용 인프로세스 DB(PGlite wasm·확장 tar 수 MB)를 함수 번들에 싣지 않는다 (PRAMI-003 §4.3.9, AC-330 ③).
  // src/db/index.ts 의 동적 import('@electric-sql/pglite') 는 DB_DRIVER=pglite 일 때만 실행된다. 검사: pnpm check:trace
  ...(IS_NEON_BUILD ? { outputFileTracingExcludes: { '/**': [...PGLITE_TRACE_EXCLUDES] } } : {}),
  poweredByHeader: false,
  logging: {
    // 개발 모드에서 Next 는 Server Function 호출을 인자째 터미널에 찍는다(기본 true) — LLM API 키 평문이 dev 로그에 남으므로 끈다
    // (PRAMI-002 QA H-1, 불변식 I-3·T-3). 문서: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/logging.md
    // production(`next start`)은 이 로그를 원래 남기지 않는다. 요청 로그(incomingRequests)는 인자가 없어 유지한다.
    serverFunctions: false,
  },
  // 보안 헤더 (§4.8, AC-91): 정적 자원 포함 전체. CSP 는 요청별 nonce 가 필요해 proxy.ts 가 붙인다
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }];
  },
  // 개발 도구 배지가 접힌 사이드바 하단 버튼을 가리므로 끈다 (오류 오버레이는 그대로 동작)
  devIndicators: false,
  // next dev 가 AGENTS.md/CLAUDE.md 를 자동 생성·수정하지 않도록 끈다 (운영 문서는 Main 이 관리).
  // Next 16.3 문서: node_modules/next/dist/docs/01-app/02-guides/ai-agents.md "Opting out"
  agentRules: false,
  experimental: {
    // proxy(1차 방어)를 거치는 요청 본문 상한. 넘는 본문은 proxy 가 잘라 Route 가 "본문을 읽을 수 없습니다"(400)가 되므로
    // 가장 큰 업로드(품목조회 합계 25MB, PRAMI-003 §4.2.3) + multipart 여유보다 크게 둔다(26MB, QA M-2).
    // 그보다 작은 초과분은 Route 가 Content-Length 로 413 을 낸다. Vercel 함수 본문 한도(4.5MB)는 플랫폼이 먼저 413 을 낸다(I-4)
    proxyClientMaxBodySize: PROXY_BODY_LIMIT_BYTES,
  },
};

export default nextConfig;
