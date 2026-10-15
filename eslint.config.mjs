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

/** 원가 우회(동적 import·require·관계형 쿼리·raw SQL) 금지 선택자 (PR-5 QA LOW-2, §4.8 AC-42) */
const COST_SYNTAX = [
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
  // 원가 매핑(cost_item_links, 스펙 cost-ratio-price-change §2.1-1)도 원가 영역 — 관계형 쿼리·raw SQL 모두 server/cost 안에서만
  {
    selector: "MemberExpression[property.name='costItemLinks']",
    message:
      '원가 매핑 관계형 쿼리(db.query.costItemLinks)는 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
  },
  {
    selector: 'Literal[value=/(^|[^_a-zA-Z])cost_item_links/]',
    message:
      '원가 매핑 테이블(cost_item_links) raw SQL 은 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
  },
  {
    selector: 'TemplateElement[value.raw=/(^|[^_a-zA-Z])cost_item_links/]',
    message:
      '원가 매핑 테이블(cost_item_links) raw SQL 은 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
  },
];

/**
 * PRAMI-002 §4.5.2·AC-231: 모델 ID 는 `src/server/llm/models.ts` 한 곳에서만 — 밖의 `claude-|gpt-|gemini-` 리터럴 금지 (tests 제외).
 * flat config 는 같은 규칙을 뒤 블록이 덮어쓰므로 원가 선택자와 **합쳐서** 건다.
 */
const MODEL_ID_MESSAGE =
  '모델 ID 리터럴(claude-|gpt-|gemini-)은 src/server/llm/models.ts 에서만 씁니다 (PRAMI-002 §4.5.2).';
const MODEL_ID_SYNTAX = [
  { selector: 'Literal[value=/^(claude-|gpt-|gemini-)/]', message: MODEL_ID_MESSAGE },
  { selector: 'TemplateElement[value.raw=/^(claude-|gpt-|gemini-)/]', message: MODEL_ID_MESSAGE },
];

const MODEL_CONSTANTS_FILE = 'src/server/llm/models.ts';

/**
 * PR-5 QA LOW-2 보강: 정적 import 외에 동적 `import('@/server/cost/…')`와 원가 테이블 스키마(materialCosts) 직접 사용도
 * 허용 목록 밖에서는 막는다. 스키마 정의·관계(src/db)와 임포트 스테이징(server/imports)은 예외.
 */
const restrictCostSyntax = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [...COST_IMPORT_ALLOWLIST, 'src/db/**', ...CREDENTIALS_ALLOWLIST],
  rules: {
    'no-restricted-syntax': ['error', ...COST_SYNTAX, ...MODEL_ID_SYNTAX],
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
          {
            name: '@/db/schema',
            importNames: ['costItemLinks'],
            message:
              '원가 매핑 스키마(costItemLinks)는 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
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
          {
            group: ['@/db/schema/cost-item-links', '**/schema/cost-item-links'],
            message:
              '원가 매핑 스키마(cost-item-links)는 server/cost 안에서만 사용할 수 있습니다 (§4.8 AC-42).',
          },
        ],
      },
    ],
  },
};

/**
 * PRAMI-003 §4.3.10·§4.9.2 운영 점검(server/ops: 헬스 deep·data:verify)은 원가 **행 수**가 필요하다.
 * 원가 값이 없는 개수 전용 모듈 `server/cost/row-count` 하나만 예외로 허용한다 — 나머지 원가 모듈·스키마·raw SQL 제한은 그대로.
 */
const COST_ROW_COUNT_MODULE = '@/server/cost/row-count';
const opsRowCountException = {
  files: ['src/server/ops/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: restrictCostSyntax.rules['no-restricted-imports'][1].paths,
        // gitignore 문법상 디렉터리 패턴('@/server/cost')이 있으면 하위 예외를 되살릴 수 없어, 모듈 루트는 정규식으로 분리한다
        patterns: restrictCostSyntax.rules['no-restricted-imports'][1].patterns.flatMap((entry) =>
          entry.group?.includes('@/server/cost/*')
            ? [
                {
                  ...entry,
                  group: ['@/server/cost/*', '**/server/cost/*', `!${COST_ROW_COUNT_MODULE}`],
                },
                { regex: '^(@/|.*/)?server/cost$', message: entry.message },
              ]
            : [entry],
        ),
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

/** 모델 상수 파일: 원가 선택자만 (모델 ID 리터럴 허용) */
const modelConstants = {
  files: [MODEL_CONSTANTS_FILE],
  rules: { 'no-restricted-syntax': ['error', ...COST_SYNTAX] },
};

/** 원가 선택자가 빠지는 경로(원가 허용 목록·src/db)에도 모델 ID 리터럴 제한은 건다 */
const restrictModelIdsElsewhere = {
  files: [...COST_IMPORT_ALLOWLIST, 'src/db/**'].map((glob) =>
    glob.replace('/**', '/**/*.{ts,tsx}'),
  ),
  rules: { 'no-restricted-syntax': ['error', ...MODEL_ID_SYNTAX] },
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
  opsRowCountException,
  credentialsModule,
  restrictCredentialsInCost,
  modelConstants,
  restrictModelIdsElsewhere,
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
