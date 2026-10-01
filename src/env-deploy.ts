import { dbHostOf, isPrivateDbHost } from './lib/db-host';

/**
 * 운영 기동 검사 (PRAMI-003 §4.3.3, fail-closed). env.ts 의 parseEnv 가 스키마 검증 뒤에 호출한다.
 * - production: `VERCEL_ENV=production` 또는 (`NODE_ENV=production` ∧ `APP_ENV=production`) — 위반 하나라도 있으면 기동·빌드 거부
 * - preview: `VERCEL_ENV=preview` — ⓕ·ⓖ 는 경고, 나머지는 거부
 * - ⓚ(PRAMI-003 PR-3 OAuth 운영화: `AUTH_REQUIRE_HD`·리다이렉트 프록시 설정)는 두 환경 모두 거부
 * 메시지에는 변수 이름만 쓴다(값 없음). 원문(source)을 함께 받는 이유는 ⓐ 처럼 "설정 자체" 를 봐야 하는 규칙 때문이다.
 */
export type DeployTarget = 'production' | 'preview';

export type DeployRuleId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'seed';

export type DeployIssue = { rule: DeployRuleId; keys: string[]; message: string };

export type DeployCheckResult = { errors: DeployIssue[]; warnings: DeployIssue[] };

/** 검사에 필요한 파싱 결과 필드 (env.ts 의 Env 부분 집합 — 순환 import 를 피하려고 구조로 받는다) */
export type DeployCheckEnv = {
  NODE_ENV: string;
  NEXT_PUBLIC_APP_URL: string;
  DB_DRIVER: string;
  DATABASE_URL?: string;
  AUTH_URL?: string;
  AUTH_REDIRECT_PROXY_URL?: string;
  AUTH_REQUIRE_HD: boolean;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  ADMIN_EMAILS: readonly string[];
  TRUST_PROXY_HEADERS: string;
  RATE_LIMIT_BACKEND: string;
  RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION: boolean;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  LLM_VENDOR_MODE: string;
  CHAT_LLM_ENABLED: boolean;
  LLM_CREDENTIALS_KEKS?: string;
};

type Source = Record<string, string | undefined>;

const isSet = (source: Source, key: string) => (source[key] ?? '').trim() !== '';
const isTruthyWord = (value: string | undefined) =>
  value !== undefined && ['true', '1', 'yes'].includes(value.trim().toLowerCase());

const normalized = (value: string | undefined) => value?.trim().toLowerCase() ?? '';

/**
 * 대소문자·공백을 무시한다(`Preview`·`PRODUCTION` 으로 검사를 건너뛰지 않게, PR-2 QA L-1).
 * Vercel 이 주입하지 않는 `VERCEL_ENV` 값(오타·수동 설정)은 preview 로 다룬다 — `development`(`vercel dev`)만 제외.
 */
export function deployTarget(source: Source): DeployTarget | null {
  const vercelEnv = normalized(source.VERCEL_ENV);
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv && vercelEnv !== 'development') return 'preview';
  if (normalized(source.NODE_ENV) === 'production' && normalized(source.APP_ENV) === 'production') {
    return 'production';
  }
  return null;
}

/**
 * 운영·preview 처럼 다뤄야 하는 배포 환경인지 — 시연 데이터 차단(L3 로그인·L4 기동·헬스 data)의 기준.
 * Vercel(`VERCEL_ENV` 아무 값)과 자체 호스팅 production(`NODE_ENV=production` ∧ `APP_ENV=production`) 모두 포함.
 */
export function isDeployedEnvironment(source: Source): boolean {
  return Boolean(source.VERCEL_ENV?.trim()) || deployTarget(source) !== null;
}

/** 테스트 모드 관련 키 — 값이 false 여도 "설정 자체" 를 거부한다 (ⓐ) */
export const TEST_MODE_KEYS = [
  'AUTH_TEST_MODE',
  'AUTH_TEST_PASSWORD',
  'AUTH_TEST_MODE_ALLOW_REMOTE',
] as const;

/** `AUTH_REDIRECT_PROXY_URL` 형식: https://<고정 preview 호스트>/api/auth (Auth.js 가 /callback/<provider> 를 붙인다) */
function isProxyUrlShape(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.pathname.replace(/\/$/, '') === '/api/auth' && !url.search
    );
  } catch {
    return false;
  }
}

/**
 * ⓚ OAuth 운영화 (PRAMI-003 PR-3, §4.4.1) — production·preview 모두 거부:
 * - `AUTH_REQUIRE_HD=true` 필수 (Google `hd` 클레임 서버 검증)
 * - production 에 `AUTH_REDIRECT_PROXY_URL` 금지 (운영 로그인이 preview 호스트를 거치면 안 됨)
 * - preview 의 `AUTH_REDIRECT_PROXY_URL` 은 `https://<고정 호스트>/api/auth`, 함께 `AUTH_URL` 을 두면 거부
 *   (next-auth 가 모든 요청 origin 을 AUTH_URL 로 바꿔 배포별 preview 의 state·PKCE 쿠키와 콜백이 어긋난다)
 */
function oauthIssue(env: DeployCheckEnv, target: DeployTarget): DeployIssue | null {
  const problems: Array<[key: string, why: string]> = [];
  if (!env.AUTH_REQUIRE_HD) problems.push(['AUTH_REQUIRE_HD', 'true 여야 합니다']);
  const proxy = env.AUTH_REDIRECT_PROXY_URL;
  if (target === 'production' && proxy !== undefined) {
    problems.push(['AUTH_REDIRECT_PROXY_URL', 'production 에는 설정하지 않습니다']);
  }
  if (target === 'preview' && proxy !== undefined) {
    if (!isProxyUrlShape(proxy)) {
      problems.push([
        'AUTH_REDIRECT_PROXY_URL',
        'https://<고정 preview 호스트>/api/auth 형식이어야 합니다',
      ]);
    }
    // 프록시는 고정 preview 호스트 자신이어야 한다 — 다른 호스트로 Google 콜백(code)이 새지 않게 (보안 리뷰 LOW)
    else if (new URL(proxy).origin !== new URL(env.NEXT_PUBLIC_APP_URL).origin) {
      problems.push([
        'AUTH_REDIRECT_PROXY_URL',
        'NEXT_PUBLIC_APP_URL(고정 preview 호스트)과 같은 origin 이어야 합니다',
      ]);
    }
    if (env.AUTH_URL !== undefined) {
      problems.push([
        'AUTH_URL',
        'AUTH_REDIRECT_PROXY_URL 과 함께 두지 않습니다 (preview 는 AUTH_URL 미설정)',
      ]);
    }
  }
  if (problems.length === 0) return null;
  return issue(
    'k',
    problems.map(([key]) => key),
    problems.map(([key, why]) => `${key} ${why}`).join(' · '),
  );
}

type Rule = (source: Source, env: DeployCheckEnv, target: DeployTarget) => DeployIssue | null;

const issue = (rule: DeployRuleId, keys: string[], message: string): DeployIssue => ({
  rule,
  keys,
  message,
});

const RULES: Rule[] = [
  (source) => {
    const keys = TEST_MODE_KEYS.filter((key) => isSet(source, key));
    return keys.length > 0
      ? issue(
          'a',
          keys,
          `${keys.join(', ')} 를 설정할 수 없습니다 (테스트 모드 금지 — 값이 false 여도 키를 지우세요)`,
        )
      : null;
  },
  (source) =>
    isSet(source, 'IMPORT_FAULT_INJECTION')
      ? issue(
          'b',
          ['IMPORT_FAULT_INJECTION'],
          'IMPORT_FAULT_INJECTION 을 설정할 수 없습니다 (QA 전용)',
        )
      : null,
  (source, env) => {
    const keys = [
      ...(env.LLM_VENDOR_MODE === 'fake' ? ['LLM_VENDOR_MODE'] : []),
      ...['LANGSMITH_TRACING', 'LANGCHAIN_TRACING_V2'].filter((key) => isTruthyWord(source[key])),
    ];
    return keys.length > 0
      ? issue('c', keys, `${keys.join(', ')} — 가짜 벤더·외부 트레이싱은 허용하지 않습니다`)
      : null;
  },
  (_source, env) =>
    env.TRUST_PROXY_HEADERS !== 'vercel'
      ? issue('d', ['TRUST_PROXY_HEADERS'], 'TRUST_PROXY_HEADERS 는 vercel 이어야 합니다')
      : null,
  (_source, env) => {
    if (env.DB_DRIVER !== 'neon' || !env.DATABASE_URL) {
      return issue(
        'e',
        ['DB_DRIVER', 'DATABASE_URL'],
        'DB_DRIVER=neon 과 DATABASE_URL 이 필요합니다',
      );
    }
    const host = dbHostOf(env.DATABASE_URL);
    if (host === null) {
      // ?host=·?hostaddr=·소켓 경로 등 — 실제 연결 호스트를 알 수 없으면 거부 (PR-2 QA M-1, fail-closed)
      return issue(
        'e',
        ['DATABASE_URL'],
        'DATABASE_URL 의 연결 호스트를 판정할 수 없습니다 (host·hostaddr 쿼리·소켓 경로 없이 postgresql://<호스트>/… 형식)',
      );
    }
    return isPrivateDbHost(host)
      ? issue('e', ['DATABASE_URL'], 'DATABASE_URL 호스트가 로컬·사설 주소입니다')
      : null;
  },
  (_source, env, target) => {
    // preview 가 리다이렉트 프록시를 쓰면 AUTH_URL 을 두지 않는다 (배포별 origin 유지 — 규칙 ⓚ, PRAMI-003 §4.4.1)
    const authUrlOk =
      env.AUTH_URL?.startsWith('https://') ||
      (target === 'preview' && env.AUTH_REDIRECT_PROXY_URL !== undefined);
    const keys = [
      ...(env.NEXT_PUBLIC_APP_URL.startsWith('https://') ? [] : ['NEXT_PUBLIC_APP_URL']),
      ...(authUrlOk ? [] : ['AUTH_URL']),
    ];
    return keys.length > 0
      ? issue('f', keys, `${keys.join(', ')} 는 https:// 주소여야 합니다`)
      : null;
  },
  (_source, env) =>
    env.ADMIN_EMAILS.length === 0
      ? issue('g', ['ADMIN_EMAILS'], 'ADMIN_EMAILS 가 비어 있습니다 (첫 관리자 부트스트랩 불가)')
      : null,
  (_source, env) => {
    // AUTH_SECRET: 세션 서명 + rate limit IP 키 HMAC 의 근거 — 없으면 HMAC 키가 고정 상수로 떨어진다 (PR-2 QA L-4)
    const keys = (['AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'] as const).filter(
      (key) => !env[key],
    );
    return keys.length > 0 ? issue('h', [...keys], `${keys.join(', ')} 가 필요합니다`) : null;
  },
  (_source, env) => {
    if (env.RATE_LIMIT_BACKEND === 'memory' && !env.RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION) {
      return issue(
        'i',
        ['RATE_LIMIT_BACKEND', 'RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION'],
        'RATE_LIMIT_BACKEND=memory 는 RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION=true(위험 수용 기록)일 때만 허용됩니다',
      );
    }
    return null;
  },
  (_source, env) =>
    env.CHAT_LLM_ENABLED && !env.LLM_CREDENTIALS_KEKS
      ? issue(
          'j',
          ['LLM_CREDENTIALS_KEKS'],
          'CHAT_LLM_ENABLED=true 이면 LLM_CREDENTIALS_KEKS 가 필요합니다',
        )
      : null,
  (_source, env, target) => oauthIssue(env, target),
  (source) =>
    isSet(source, 'PRAMI_ALLOW_SEED')
      ? issue(
          'seed',
          ['PRAMI_ALLOW_SEED'],
          'PRAMI_ALLOW_SEED 를 설정할 수 없습니다 (시연 데이터 금지)',
        )
      : null,
];

/** preview 에서 경고로 낮추는 규칙 (§4.3.3) */
const PREVIEW_WARN_ONLY: ReadonlySet<DeployRuleId> = new Set(['f', 'g']);

export function checkDeployment(source: Source, env: DeployCheckEnv): DeployCheckResult {
  const target = deployTarget(source);
  if (!target) return { errors: [], warnings: [] };
  const found = RULES.map((rule) => rule(source, env, target)).filter(
    (x): x is DeployIssue => x !== null,
  );
  if (target === 'production') return { errors: found, warnings: [] };
  return {
    errors: found.filter((entry) => !PREVIEW_WARN_ONLY.has(entry.rule)),
    warnings: found.filter((entry) => PREVIEW_WARN_ONLY.has(entry.rule)),
  };
}

export function formatDeployIssues(target: DeployTarget, issues: DeployIssue[]): string {
  return issues.map((entry) => `  ✖ [${target} ${entry.rule}] ${entry.message}`).join('\n');
}
