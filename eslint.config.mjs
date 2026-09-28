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

/**
 * PR-5 QA LOW-2 보강: 정적 import 외에 동적 `import('@/server/cost/…')`와 원가 테이블 스키마(materialCosts) 직접 사용도
 * 허용 목록 밖에서는 막는다. 스키마 정의·관계(src/db)와 임포트 스테이징(server/imports)은 예외.
 */
const restrictCostSyntax = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [...COST_IMPORT_ALLOWLIST, 'src/db/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ImportExpression > Literal[value=/(^|[\/])server[\/]cost([\/]|$)/]',
        message:
          '원가 모듈(server/cost)은 동적 import 로도 허용 목록 밖에서 불러올 수 없습니다 (§4.8 AC-42).',
      },
      {
        selector:
          "CallExpression[callee.name='require'] > Literal[value=/(^|[\/])server[\/]cost([\/]|$)/]",
        message: '원가 모듈(server/cost)은 require 로도 불러올 수 없습니다 (§4.8 AC-42).',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@/db/schema',
            importNames: ['materialCosts', 'MATERIAL_COST_SERIES_KEY_SQL'],
            message:
              '원가 테이블 스키마(materialCosts)는 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
          },
        ],
        patterns: [
          {
            group: ['@/server/cost', '@/server/cost/*', '**/server/cost', '**/server/cost/*'],
            message:
              '원가 모듈(server/cost)은 features/costs, app/(app)/admin/costs 에서만 import 할 수 있습니다 (§4.8 AC-42).',
          },
          {
            group: ['@/db/schema/material-costs', '**/schema/material-costs'],
            message:
              '원가 테이블 스키마(material-costs)는 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
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
  restrictCostSyntax,
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
