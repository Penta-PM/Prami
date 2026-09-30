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
 * PRAMI-002 §4.7.3 T-7·AC-205 ④: LLM 자격 증명 테이블(암호문·DEK 컬럼)은 `server/llm/credentials/**` 에서만 import 한다.
 * 스키마 정의(src/db)는 예외. flat config 는 같은 규칙을 뒤 블록이 덮어쓰므로 원가 제한과 **합쳐서** 건다.
 */
const CREDENTIALS_ALLOWLIST = ['src/server/llm/credentials/**'];

const CREDENTIAL_SCHEMA_PATHS = [
  {
    name: '@/db/schema',
    importNames: ['userLlmCredentials'],
    message:
      'LLM 자격 증명 스키마(userLlmCredentials)는 server/llm/credentials 안에서만 사용할 수 있습니다 (PRAMI-002 T-7).',
  },
];

const CREDENTIAL_SCHEMA_PATTERNS = [
  {
    group: ['@/db/schema/llm-credentials', '**/schema/llm-credentials'],
    message:
      'LLM 자격 증명 스키마(llm-credentials)는 server/llm/credentials 안에서만 사용할 수 있습니다 (PRAMI-002 T-7).',
  },
];

/**
 * PR-5 QA LOW-2 보강: 정적 import 외에 동적 `import('@/server/cost/…')`와 원가 테이블 스키마(materialCosts) 직접 사용도
 * 허용 목록 밖에서는 막는다. 스키마 정의·관계(src/db)와 임포트 스테이징(server/imports)은 예외.
 */
const restrictCostSyntax = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [...COST_IMPORT_ALLOWLIST, 'src/db/**', ...CREDENTIALS_ALLOWLIST],
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
      {
        // r5 AC-42 ③: 템플릿 리터럴·변수 경로 동적 import 는 경로를 정적으로 검사할 수 없으므로 통째로 막는다
        selector: 'ImportExpression > :not(Literal)',
        message:
          '동적 import 경로는 문자열 리터럴만 허용합니다 — 원가 모듈(server/cost) 우회를 막기 위한 규칙입니다 (§4.8 AC-42).',
      },
      {
        selector: "MemberExpression[property.name='materialCosts']",
        message:
          '원가 테이블 관계형 쿼리(db.query.materialCosts)는 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
      },
      {
        // raw SQL 로 원가 테이블을 직접 읽는 것도 막는다 (stg_material_costs 는 스테이징이라 제외)
        selector: 'Literal[value=/(^|[^_a-zA-Z])material_costs/]',
        message:
          '원가 테이블(material_costs) raw SQL 은 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
      },
      {
        selector: 'TemplateElement[value.raw=/(^|[^_a-zA-Z])material_costs/]',
        message:
          '원가 테이블(material_costs) raw SQL 은 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          ...CREDENTIAL_SCHEMA_PATHS,
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
          ...CREDENTIAL_SCHEMA_PATTERNS,
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

/** 자격 증명 모듈 자신: 원가 제한은 그대로, 자격 증명 스키마는 허용 */
const credentialsModule = {
  ...restrictCostSyntax,
  files: CREDENTIALS_ALLOWLIST.map((glob) => glob.replace('/**', '/**/*.{ts,tsx}')),
  ignores: [],
  rules: {
    ...restrictCostSyntax.rules,
    'no-restricted-imports': [
      'error',
      {
        paths: restrictCostSyntax.rules['no-restricted-imports'][1].paths.filter(
          (entry) => !CREDENTIAL_SCHEMA_PATHS.includes(entry),
        ),
        patterns: restrictCostSyntax.rules['no-restricted-imports'][1].patterns.filter(
          (entry) => !CREDENTIAL_SCHEMA_PATTERNS.includes(entry),
        ),
      },
    ],
  },
};

/** 원가 허용 목록 파일에도 자격 증명 스키마 제한은 건다 */
const restrictCredentialsInCost = {
  files: COST_IMPORT_ALLOWLIST.map((glob) => glob.replace('/**', '/**/*.{ts,tsx}')),
  rules: {
    'no-restricted-imports': [
      'error',
      { paths: CREDENTIAL_SCHEMA_PATHS, patterns: CREDENTIAL_SCHEMA_PATTERNS },
    ],
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  restrictCostImports,
  restrictCostSyntax,
  credentialsModule,
  restrictCredentialsInCost,
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
