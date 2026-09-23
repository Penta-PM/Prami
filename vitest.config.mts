import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  'server-only': path.resolve(import.meta.dirname, 'tests/helpers/server-only.ts'),
};

/**
 * 프로젝트 2개 (§4.9.2 환경 열):
 * - unit: jsdom, PGlite(memory://) — `pnpm test`. DB 테스트 파일은 `@vitest-environment node` 지시자 사용
 * - integration: node, 실제 Postgres(DB_DRIVER=pg + DATABASE_URL) — `pnpm test:integration`, CI service container
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
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
          testTimeout: 30_000,
          // 파일마다 PGlite 를 띄우고 마이그레이션하므로 병렬·커버리지 실행에서는 준비 시간이 길어진다
          hookTimeout: 60_000,
          env: { DB_DRIVER: 'pglite', PGLITE_DATA_DIR: 'memory://' },
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
    ],
  },
});
