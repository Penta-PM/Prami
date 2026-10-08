import { availableParallelism } from 'node:os';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** 테스트 전용 KEK — 'test' 표식에서 파생 (PRAMI-002 §4.13) */
const TEST_KEKS = `1:${Buffer.alloc(32, 'test-kek-v1').toString('base64')}`;

const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  'server-only': path.resolve(import.meta.dirname, 'tests/helpers/server-only.ts'),
};

/**
 * 프로젝트 3개 (§4.9.2 환경 열):
 * - unit: jsdom, PGlite(memory://) — `pnpm test`. DB 테스트 파일은 `@vitest-environment node` 지시자 사용
 * - integration: node, 실제 Postgres(DB_DRIVER=pg + DATABASE_URL) — `pnpm test:integration`, CI service container
 * - neon: node, 실제 Neon 드라이버(DB_DRIVER=neon + 일회용 Neon 브랜치) — `pnpm test:neon`, 체크리스트 C-6 (PR #26 D-2).
 *   환경이 없으면 실패한다(0건 통과 방지). 로컬 예행은 NEON_LOCAL_PG_URL(격리 PG) — tests/neon/setup.ts
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    // 파일마다 PGlite(wasm)를 띄우므로 코어 수보다 많이 병렬이면 준비 단계가 서로 밀려 타임아웃난다 (CI 사용량 절감 PR-C).
    // CI: 러너 코어 수(GitHub-hosted private 2코어). 로컬: 검증 규칙(docs/pipeline/verification.md)대로 2 — 4코어 공유 호스트.
    // 둘 다 VITEST_MAX_WORKERS 로 덮어쓸 수 있다.
    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : process.env.CI
        ? availableParallelism()
        : 2,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // 루트 레이아웃은 <html> 을 렌더해 jsdom 단위 테스트 대상이 아니다 (E2E 로 검증).
      // Drizzle 스키마 정의는 선언 전용이며 마이그레이션 스냅샷 테스트로 검증한다.
      exclude: ['src/app/layout.tsx', 'src/db/schema/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup.ts'],
          css: false,
          // next-auth 는 'next/server' 를 확장자 없이 import 해 Node ESM 이 직접 읽으면 실패한다 — Vite 로 변환해 해석한다
          // (PRAMI-003 AC-342·343: 실제 Auth.js 핸들러로 302 Location·쿠키 검사)
          server: { deps: { inline: ['next-auth'] } },
          testTimeout: 30_000,
          // 파일마다 PGlite 를 띄우고 마이그레이션하므로 병렬·커버리지 실행에서는 준비 시간이 길어진다
          hookTimeout: 60_000,
          env: {
            DB_DRIVER: 'pglite',
            PGLITE_DATA_DIR: 'memory://',
            RATE_LIMIT_PER_MIN: '1000',
            // PRAMI-002 §4.13: 테스트 KEK 는 코드로 만든다(저장소에 base64 리터럴을 두지 않음 — secret-scan)
            LLM_CREDENTIALS_KEKS: TEST_KEKS,
            LLM_CREDENTIALS_ACTIVE_KEK: '1',
            LLM_VENDOR_MODE: 'fake',
            LLM_VERIFY_PER_MIN: '1000',
            // PRAMI-002 §4.13: 단위·통합의 모델 호출 타임아웃 (가짜 지연 테스트 AC-229 ③)
            CHAT_LLM_TIMEOUT_MS: '2000',
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // 같은 DB 에 마이그레이션을 동시에 적용하면 CREATE EXTENSION 이 경합하므로 파일을 순차 실행한다
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'neon',
          environment: 'node',
          include: ['tests/neon/**/*.neon.test.ts'],
          setupFiles: ['tests/neon/setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
