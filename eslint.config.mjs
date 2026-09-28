import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * 원가 모듈 격리 (§4.8, AC-42): `server/cost` 는 원가 관리 화면·서버 모듈 자신만 import 할 수 있다.
 * 공개 조회(가격정책·챗봇·견적 등) 경로에서 원가가 새는 것을 정적으로 막는다. 위반 시 lint 실패.
 */
const COST_IMPORT_ALLOWLIST = [
  'src/server/cost/**',
  'src/features/costs/**',
  'src/app/(app)/admin/costs/**',
];

const restrictCostImports = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: COST_IMPORT_ALLOWLIST,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/server/cost', '@/server/cost/*', '**/server/cost', '**/server/cost/*'],
            message:
              '원가 모듈(server/cost)은 features/costs, app/(app)/admin/costs 에서만 import 할 수 있습니다 (§4.8 AC-42).',
          },
        ],
      },
    ],
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  restrictCostImports,
  globalIgnores([
    '.next/**',
    '.next-e2e/**',
    // NEXT_DIST_DIR 로 바꾼 임의의 산출물 폴더 (.next-*, .nextqa 등)
    '.next*/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
]);
