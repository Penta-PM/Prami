import { TEST_MODE_KEYS } from '@/env-deploy';

import { checkSecurityHeaders, type SmokeFetch } from './smoke-checks';

/**
 * `pnpm release:check env|schema|data|headers` (PRAMI-003 §4.3.12 C-3·C-5·C-7/C-8·C-9, AC-365).
 * 판정 로직만 둔다 — 입출력(파일·Vercel CLI·DB·HTTP)은 `deps` 로 주입한다(scripts/release-check.ts).
 * 출력에는 변수 **이름**·상태 코드·항목 판정만 싣는다. 값은 읽지 않거나(Vercel `env ls`) 읽어도 출력하지 않는다.
 * 하나라도 실패하면 exit 1.
 */
export const RELEASE_TARGETS = ['local', 'preview', 'production'] as const;
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
export const RELEASE_COMMANDS = ['env', 'schema', 'data', 'headers'] as const;
export type ReleaseCommand = (typeof RELEASE_COMMANDS)[number];

export type CheckRow = { item: string; expected: string; actual: string; ok: boolean };

/** §4.3.2 필수 열 — 배포 환경 공통 (값은 보지 않고 이름만) */
const DEPLOYED_REQUIRED = [
  'NEXT_PUBLIC_APP_URL',
  'DB_DRIVER',
  'DATABASE_URL',
  'AUTH_SECRET',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
  'ALLOWED_EMAIL_DOMAINS',
  'AUTH_REQUIRE_HD',
  'ADMIN_EMAILS',
  'TRUST_PROXY_HEADERS',
  'RATE_LIMIT_BACKEND',
  'LLM_CREDENTIALS_KEKS',
  'LLM_CREDENTIALS_ACTIVE_KEK',
] as const;

/** §4.3.2 금지·§4.3.3 ⓐⓑⓒ·seed — 배포 환경 공통. DATABASE_URL_UNPOOLED 는 GitHub Environment 시크릿 전용(Vercel 런타임 금지) */
const DEPLOYED_FORBIDDEN = [
  ...TEST_MODE_KEYS,
  'AUTH_TEST_ALLOWED_HOSTS',
  'IMPORT_FAULT_INJECTION',
  'LLM_VENDOR_MODE',
  'LANGSMITH_TRACING',
  'LANGCHAIN_TRACING_V2',
  'PRAMI_ALLOW_SEED',
  'DATABASE_URL_UNPOOLED',
  'NEXTAUTH_URL',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
] as const;

export const ENV_RULES: Record<
  ReleaseTarget,
  { required: readonly string[]; forbidden: readonly string[] }
> = {
  production: {
    required: [...DEPLOYED_REQUIRED, 'AUTH_URL'],
    forbidden: [...DEPLOYED_FORBIDDEN, 'AUTH_REDIRECT_PROXY_URL'],
  },
  // preview 는 리다이렉트 프록시 + AUTH_URL 미설정 (§4.4.1, 기동 검사 ⓚ)
  preview: {
    required: [...DEPLOYED_REQUIRED, 'AUTH_REDIRECT_PROXY_URL'],
    forbidden: [...DEPLOYED_FORBIDDEN, 'AUTH_URL'],
  },
  // 로컬 :3000 — 시드 표식 금지(§4.3.2 r3), 외부 트레이싱 금지
  local: {
    required: [
      'NEXT_PUBLIC_APP_URL',
      'DB_DRIVER',
      'AUTH_SECRET',
      'ALLOWED_EMAIL_DOMAINS',
      'ADMIN_EMAILS',
    ],
    forbidden: [
      'PRAMI_ALLOW_SEED',
      'LANGSMITH_TRACING',
      'LANGCHAIN_TRACING_V2',
      'DATABASE_URL_UNPOOLED',
    ],
  },
};

/** env 이름 목록 비교 (C-3). Upstash 는 백엔드가 memory 예외(위험 수용 키)일 때만 생략 가능 */
export function checkEnvNames(target: ReleaseTarget, names: ReadonlySet<string>): CheckRow[] {
  const rules = ENV_RULES[target];
  const required = [...rules.required];
  if (target !== 'local' && !names.has('RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION')) {
    required.push('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN');
  }
  return [
    ...required.map((name) => ({
      item: `필수 ${name}`,
      expected: '있음',
      actual: names.has(name) ? '있음' : '없음',
      ok: names.has(name),
    })),
    ...rules.forbidden.map((name) => ({
      item: `금지 ${name}`,
      expected: '없음',
      actual: names.has(name) ? '있음' : '없음',
      ok: !names.has(name),
    })),
  ];
}

/**
 * `vercel env ls <environment>` 출력에서 변수 이름만 꺼낸다 — 첫 열이 대문자·숫자·밑줄인 줄.
 * 값 열은 Vercel 이 "Encrypted" 로만 보여 주며, 어차피 이름 외에는 쓰지 않는다.
 */
export function parseVercelEnvNames(output: string): Set<string> {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Z][A-Z0-9_]*)\s/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name) && name !== 'NAME'),
  );
}

/**
 * `vercel env ls` 출력 → 이름 집합. 이름을 하나도 못 읽었으면 "전부 누락" 으로 판정하지 않고 실행 실패로 알린다
 * (출력 형식 변화·미연결 — PR #26 F-9, I2-7)
 */
export function vercelEnvNamesOrThrow(output: string): Set<string> {
  const names = parseVercelEnvNames(output);
  if (names.size === 0) throw new Error('vercel env ls 출력에서 이름을 찾지 못함');
  return names;
}

export type ReleaseCheckArgs = {
  command: ReleaseCommand;
  target: ReleaseTarget;
  url?: string;
  targetHost?: string;
  namesFile?: string;
};

export function parseReleaseCheckArgs(argv: readonly string[]): ReleaseCheckArgs {
  const [command, ...rest] = argv;
  if (!(RELEASE_COMMANDS as readonly string[]).includes(command ?? '')) {
    throw new Error(`하위 명령: ${RELEASE_COMMANDS.join('|')}`);
  }
  const option = (name: string) => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const target = option('--target') ?? 'local';
  if (!(RELEASE_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`--target: ${RELEASE_TARGETS.join('|')}`);
  }
  // data 하위 명령이 셸 명령으로 넘기므로 호스트 이름 문자만 허용한다 (명령 주입 방지)
  const host = option('--target-host');
  if (host !== undefined && !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host)) {
    throw new Error('--target-host 는 호스트 이름이어야 합니다');
  }
  return {
    command: command as ReleaseCommand,
    target: target as ReleaseTarget,
    ...(option('--url') ? { url: option('--url') } : {}),
    ...(option('--target-host') ? { targetHost: option('--target-host') } : {}),
    ...(option('--names-file') ? { namesFile: option('--names-file') } : {}),
  };
}

export type ReleaseCheckDeps = {
  /** env 이름 목록 — local: .env 파일 키, preview·production: `vercel env ls` 또는 --names-file */
  envNames: (args: ReleaseCheckArgs) => Promise<Set<string>>;
  /** 직접 연결한 DB 의 스키마 상태 (`readSchemaState`) */
  schemaState: () => Promise<string>;
  /** `pnpm data:verify --fresh --target <t>` 종료 코드 */
  dataVerify: (args: ReleaseCheckArgs) => Promise<number>;
  fetch: SmokeFetch;
  /** --url 이 없을 때 기본 대상 URL (NEXT_PUBLIC_APP_URL) */
  defaultUrl: () => string | undefined;
};

export type ReleaseCheckResult = { rows: CheckRow[]; ok: boolean };

async function schemaRows(args: ReleaseCheckArgs, deps: ReleaseCheckDeps): Promise<CheckRow[]> {
  // --url 이 있으면 배포된 앱의 헬스로 본다(C-5 "schema:'ok'"), 없으면 직접 연결 DB
  if (args.url) {
    const response = await deps.fetch(`${args.url.replace(/\/+$/, '')}/api/health`, {
      redirect: 'manual',
    });
    const body = (await response.json().catch(() => null)) as { schema?: unknown } | null;
    // 원격 응답 값은 알려진 상태로만 출력한다 — 대상이 표를 깨거나 임의 문자열을 넣지 못하게 (보안 리뷰 L-5)
    const known = ['ok', 'behind', 'ahead', 'unknown'];
    const schema =
      typeof body?.schema === 'string' && known.includes(body.schema)
        ? body.schema
        : body
          ? 'unexpected'
          : `HTTP ${response.status}`;
    return [{ item: '헬스 schema', expected: 'ok', actual: schema, ok: schema === 'ok' }];
  }
  // 원격 대상은 배포된 앱의 헬스로만 본다 — 셸의 DATABASE_URL 이 다른 DB 를 가리켜도 엉뚱한 판정을 하지 않게 (리뷰 M1)
  if (args.target !== 'local') {
    return [
      { item: '대상', expected: '--url https://<배포 호스트>', actual: '--url 없음', ok: false },
    ];
  }
  const state = await deps.schemaState();
  return [{ item: 'DB 스키마 (저널 대비)', expected: 'ok', actual: state, ok: state === 'ok' }];
}

async function headerRows(args: ReleaseCheckArgs, deps: ReleaseCheckDeps): Promise<CheckRow[]> {
  // 원격 대상은 --url 로만 — 기본값(NEXT_PUBLIC_APP_URL = 로컬)으로 원격 판정을 내지 않게 (PR #26 F-23)
  if (args.target !== 'local' && !args.url) {
    return [
      { item: '대상', expected: '--url https://<배포 호스트>', actual: '--url 없음', ok: false },
    ];
  }
  const url = (args.url ?? deps.defaultUrl())?.replace(/\/+$/, '');
  if (!url)
    return [
      { item: '대상 URL', expected: '--url 또는 NEXT_PUBLIC_APP_URL', actual: '없음', ok: false },
    ];
  const problems = await checkSecurityHeaders((path) =>
    deps.fetch(`${url}${path}`, { redirect: 'manual' }),
  );
  return [
    {
      item: `보안 헤더 6종 + CSP nonce (${new URL(url).host})`,
      expected: '문제 0',
      actual: problems.length === 0 ? '문제 0' : problems.join(' · '),
      ok: problems.length === 0,
    },
  ];
}

export async function runReleaseCheck(
  args: ReleaseCheckArgs,
  deps: ReleaseCheckDeps,
): Promise<ReleaseCheckResult> {
  let rows: CheckRow[];
  try {
    if (args.command === 'env') rows = checkEnvNames(args.target, await deps.envNames(args));
    else if (args.command === 'schema') rows = await schemaRows(args, deps);
    else if (args.command === 'headers') rows = await headerRows(args, deps);
    else {
      const code = await deps.dataVerify(args);
      rows = [
        { item: 'data:verify --fresh', expected: 'exit 0', actual: `exit ${code}`, ok: code === 0 },
      ];
    }
  } catch (error) {
    // 오류 메시지에 연결 문자열 등이 섞일 수 있어 이름만 남긴다
    const name = error instanceof Error ? error.name : 'Error';
    rows = [
      { item: `${args.command} 실행`, expected: '성공', actual: `실패 (${name})`, ok: false },
    ];
  }
  return { rows, ok: rows.every((row) => row.ok) };
}

/**
 * 출력 제목 — 실제로 본 대상을 적는다 (PR #26 F-23). `--url` 이 있으면 그 호스트(schema·headers),
 * 없으면 `--target`(+ data 의 `--target-host`)
 */
export function releaseCheckTitle(args: ReleaseCheckArgs): string {
  if (args.url && (args.command === 'schema' || args.command === 'headers')) {
    let host = '잘못된 URL';
    try {
      host = new URL(args.url).host;
    } catch {
      // 판정 행이 실패를 보여 준다
    }
    return `release:check ${args.command} (--target ${args.target}, ${host})`;
  }
  const host = args.command === 'data' && args.targetHost ? `, ${args.targetHost}` : '';
  return `release:check ${args.command} (--target ${args.target}${host})`;
}

export function formatRows(title: string, rows: readonly CheckRow[]): string {
  const lines = rows.map(
    (row) => `| ${row.ok ? 'PASS' : 'FAIL'} | ${row.item} | ${row.expected} | ${row.actual} |`,
  );
  return [
    `## ${title}`,
    '| 판정 | 항목 | 기대 | 실측 |',
    '| --- | --- | --- | --- |',
    ...lines,
  ].join('\n');
}
