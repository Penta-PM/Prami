import { z } from 'zod';

import { checkDeployment, deployTarget, formatDeployIssues } from './env-deploy';

/**
 * 환경변수 스키마 (스펙 §4.9.2 키 전부).
 * - 빈 문자열은 "미설정"으로 취급한다 (.env.example 을 복사한 직후에도 기동 가능).
 * - DB 연결·인증 코드는 PR-1/PR-2 에서 추가되며, 여기서는 키·형식·환경별 제약만 검증한다.
 */
export const DB_DRIVERS = ['neon', 'pg', 'pglite'] as const;
export type DbDriver = (typeof DB_DRIVERS)[number];

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

/** "true"/"1"/"yes" → true, "false"/"0"/"no" → false, 미설정 → 기본값 */
function parseBooleanWord(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return value;
}

const booleanFromString = (defaultValue: boolean) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : parseBooleanWord(value)),
    z.boolean(),
  );

/** 양의 정수 (미설정이면 기본값) — rate limit 상한 등 */
const positiveIntFromString = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : Number(value)),
    z.number().int().min(1).max(100_000),
  );

/**
 * 감사 IP 신뢰 프록시 모드 (§4.8, AC-93):
 * - none(기본): 클라이언트가 위조할 수 있는 헤더를 쓰지 않는다 → ip NULL
 * - vercel: Vercel 이 덮어쓰는 x-vercel-forwarded-for → x-real-ip 순. x-forwarded-for 는 쓰지 않는다
 * - generic: x-real-ip → x-forwarded-for 오른쪽 끝(신뢰 프록시가 덧붙인 값)
 * "true" 는 generic, "false" 는 none 으로 받는다 (이전 설정 호환).
 */
export const PROXY_TRUST_MODES = ['none', 'vercel', 'generic'] as const;
export type ProxyTrustMode = (typeof PROXY_TRUST_MODES)[number];

const proxyTrustModeSchema = z.preprocess((value) => {
  if (value === undefined || value === '') return 'none';
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return 'generic';
  if (['false', '0', 'no'].includes(normalized)) return 'none';
  return normalized;
}, z.enum(PROXY_TRUST_MODES));

/** 쉼표 구분 목록 → 배열 (공백·빈 항목 제거) */
const csvList = (item: z.ZodType<string>, defaultValue: string[]) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : value,
    z.array(item).default(defaultValue),
  );

export const RATE_LIMIT_BACKENDS = ['memory', 'upstash'] as const;
export type RateLimitBackend = (typeof RATE_LIMIT_BACKENDS)[number];

const envShape = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Vercel 밖 운영(자체 호스팅)에서 NODE_ENV=production 과 함께 production 으로 표시 — 운영 기동 검사 대상 (PRAMI-003 §4.3.3) */
  APP_ENV: optionalString,
  NEXT_PUBLIC_APP_URL: z.preprocess(emptyToUndefined, z.url().default('http://localhost:3000')),

  // ── DB (§4.9) ──────────────────────────────────────────────────────────
  /** neon: Vercel / pg: 로컬 Docker Postgres·QA·CI e2e / pglite: 단위·통합 테스트(인프로세스). 미설정 시 pglite */
  DB_DRIVER: z.preprocess(emptyToUndefined, z.enum(DB_DRIVERS).default('pglite')),
  DATABASE_URL: optionalUrl,
  /** 마이그레이션·pg_dump 전용 직접 연결 (Neon 비풀링). Vercel 런타임에 두지 않는다 — scripts/migrate.ts 가 우선 사용 (§4.3.4) */
  DATABASE_URL_UNPOOLED: optionalUrl,
  PGLITE_DATA_DIR: optionalString,
  /** seed·fixtures 를 이 환경에서 허용 ("1"). CI·E2E·격리 DB 만 설정, 운영·preview 에 있으면 기동 거부 (§4.9.3 L2) */
  PRAMI_ALLOW_SEED: optionalString,

  // ── 인증 (§4.6.1, Auth.js v5 Google) ───────────────────────────────────
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  AUTH_URL: optionalUrl,
  /** preview 전용: https://<고정 preview 호스트>/api/auth (Auth.js 리다이렉트 프록시, §4.4.1). production 금지·preview 는 AUTH_URL 과 함께 두지 않음(기동 검사 ⓚ) */
  AUTH_REDIRECT_PROXY_URL: optionalUrl,
  /** Google ID 토큰 `hd` 클레임 서버 검증 (§4.4.1, callbacks.ts). production·preview 는 true 필수(기동 검사 ⓚ) */
  AUTH_REQUIRE_HD: booleanFromString(false),
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  /** true 이면 테스트 전용 Credentials provider 추가. production 에서는 거부한다 */
  AUTH_TEST_MODE: booleanFromString(false),
  AUTH_TEST_PASSWORD: optionalString,
  /** 테스트 로그인을 받을 Host (포트 제외, 쉼표 구분). 밖이면 거부 + 감사 auth.denied_test_mode (§4.8 r5 ①) */
  AUTH_TEST_ALLOWED_HOSTS: csvList(z.string().min(1), ['localhost', '127.0.0.1']),
  /** VERCEL_ENV 가 있는 환경(preview/production)에서도 테스트 모드를 허용할지 — 비공개 배포 예외용, 기본 false (§4.8 r5 ②) */
  AUTH_TEST_MODE_ALLOW_REMOTE: booleanFromString(false),
  ALLOWED_EMAIL_DOMAINS: csvList(z.string().min(1), ['pentasecurity.com']),
  ADMIN_EMAILS: csvList(z.email(), []),
  AUTH_AUTO_PROVISION: booleanFromString(true),

  // ── 요청 출처 (감사 로그 IP) ────────────────────────────────────────────
  /** 감사 IP 신뢰 프록시 모드: none(기본) | vercel | generic. 위 PROXY_TRUST_MODES 설명 참고 */
  TRUST_PROXY_HEADERS: proxyTrustModeSchema,
  VERCEL: optionalString,
  /** Vercel 이 주입하는 배포 환경 (development | preview | production). 정의돼 있으면 테스트 모드 기동 거부 */
  VERCEL_ENV: optionalString,
  /** Vercel 이 주입하는 커밋 SHA — APP_RELEASE 가 없을 때 헬스·로그의 release 로 쓴다 */
  VERCEL_GIT_COMMIT_SHA: optionalString,
  /** 배포 식별자 (Actions 가 커밋 SHA 주입, 로컬 dev). 헬스·구조화 로그 `release` (§4.3.8) */
  APP_RELEASE: optionalString,
  /** 쓰기 중단: proxy 가 비 ADMIN 에 503 안내 (런북 R-3, §4.3.11) */
  MAINTENANCE_MODE: booleanFromString(false),

  // ── rate limit (§4.8 r6, AC-95) ────────────────────────────────────────
  /** 엔드포인트별 키(사용자/IP)당 분당 상한. 기본 30, 테스트 1000 — 표는 src/server/rate-limit.ts · docs/deploy/vercel.md */
  RATE_LIMIT_PER_MIN: positiveIntFromString(30),
  /** memory: 인스턴스 메모리(로컬 기본) / upstash: 분산 저장소(운영 기본, §4.3.7) */
  RATE_LIMIT_BACKEND: z.preprocess(emptyToUndefined, z.enum(RATE_LIMIT_BACKENDS).default('memory')),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  /** 운영·preview 에서 memory 백엔드를 쓰는 위험 수용 예외 — 체크리스트 C-12 에 승인자 기록 필수 */
  RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION: booleanFromString(false),

  // ── 임포트 (§4.4) ──────────────────────────────────────────────────────
  /** QA-03e 실패 주입: 지정 단계 이후 예외 (items|manual|load|recompute|verify). production 에서는 거부 */
  IMPORT_FAULT_INJECTION: z.preprocess(
    emptyToUndefined,
    z.enum(['items', 'manual', 'load', 'recompute', 'verify']).optional(),
  ),
});

// ── PRAMI-002 LLM 챗봇 · 사용자 자격 증명 (§4.13) — PRAMI-001 블록 뒤에 추가만 한다 (§6.2) ─────────────

/** `n:base64(32B)` 목록 → `[{version, key}]`. 형식 오류는 zod 오류로 (값은 오류 메시지에 넣지 않는다) */
export type KekEntry = { version: number; key: Buffer };

export function parseKekList(raw: string): KekEntry[] | null {
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed: KekEntry[] = [];
  for (const entry of entries) {
    const match = /^(\d{1,4}):([A-Za-z0-9+/=_-]+)$/.exec(entry);
    if (!match) return null;
    const key = Buffer.from(match[2]!, 'base64');
    if (key.length !== 32) return null;
    parsed.push({ version: Number(match[1]), key });
  }
  const versions = new Set(parsed.map((entry) => entry.version));
  if (versions.size !== parsed.length || parsed.some((entry) => entry.version < 1)) return null;
  return parsed;
}

const intInRange = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : Number(value)),
    z.number().int().min(min).max(max),
  );

export const LLM_VENDOR_MODES = ['live', 'fake'] as const;

const llmEnvFields = {
  /** 챗봇 LLM 경로 킬스위치 (PR-B 에서 사용, PR-A 는 설정 화면 안내에만) */
  CHAT_LLM_ENABLED: booleanFromString(true),
  CHAT_RULE_FALLBACK: booleanFromString(true),
  /** KEK 키링 `1:<base64 32B>,2:<base64 32B>` — 시크릿. 저장소·문서에 실제 값을 쓰지 않는다 */
  LLM_CREDENTIALS_KEKS: optionalString,
  LLM_CREDENTIALS_ACTIVE_KEK: z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : Number(value)),
    z.number().int().min(1).optional(),
  ),
  CHAT_LLM_MAX_OUTPUT_TOKENS: intInRange(1024, 64, 4096),
  CHAT_LLM_TIMEOUT_MS: intInRange(20_000, 1000, 55_000),
  CHAT_LLM_MAX_TOOL_CALLS: intInRange(4, 1, 8),
  CHAT_HISTORY_MAX_TURNS: intInRange(10, 0, 20),
  /** 키 검증 호출 상한: 사용자당 분당 (§4.6.3, 키 오라클 방지) */
  LLM_VERIFY_PER_MIN: positiveIntFromString(5),
  /** live: 실제 벤더 호출 / fake: 가짜 검증기·모델 (테스트·QA). production·VERCEL_ENV 에서 fake 거부 */
  LLM_VENDOR_MODE: z.preprocess(emptyToUndefined, z.enum(LLM_VENDOR_MODES).default('live')),
  LLM_OAUTH_OPENROUTER: booleanFromString(false),
  /** 외부 트레이싱(대화·도구 결과 반출, T-9) — production·VERCEL_ENV 에서 켜져 있으면 기동 거부 */
  LANGSMITH_TRACING: optionalString,
  LANGCHAIN_TRACING_V2: optionalString,
};

const fullEnvShape = envShape.extend(llmEnvFields);

const isTruthyWord = (value: string | undefined) =>
  value !== undefined && ['true', '1', 'yes'].includes(value.trim().toLowerCase());

/** PRAMI-002 교차 규칙 (§4.13, AC-210·212) */
function checkLlmRules(env: z.infer<typeof fullEnvShape>, ctx: z.RefinementCtx): void {
  const deployed = env.NODE_ENV === 'production' || Boolean(env.VERCEL_ENV);
  const keks = env.LLM_CREDENTIALS_KEKS ? parseKekList(env.LLM_CREDENTIALS_KEKS) : null;
  if (env.LLM_CREDENTIALS_KEKS && !keks) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_CREDENTIALS_KEKS'],
      message:
        'LLM_CREDENTIALS_KEKS 는 "버전:base64(32바이트)" 를 쉼표로 나열해야 합니다 (버전 중복 불가)',
    });
  }
  if (keks && env.LLM_CREDENTIALS_ACTIVE_KEK === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_CREDENTIALS_ACTIVE_KEK'],
      message: 'LLM_CREDENTIALS_KEKS 가 있으면 LLM_CREDENTIALS_ACTIVE_KEK 가 필요합니다',
    });
  }
  if (
    keks &&
    env.LLM_CREDENTIALS_ACTIVE_KEK !== undefined &&
    !keks.some((entry) => entry.version === env.LLM_CREDENTIALS_ACTIVE_KEK)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_CREDENTIALS_ACTIVE_KEK'],
      message: 'LLM_CREDENTIALS_ACTIVE_KEK 버전이 LLM_CREDENTIALS_KEKS 에 없습니다',
    });
  }
  if (!env.LLM_CREDENTIALS_KEKS && env.LLM_CREDENTIALS_ACTIVE_KEK !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_CREDENTIALS_KEKS'],
      message: 'LLM_CREDENTIALS_ACTIVE_KEK 가 있으면 LLM_CREDENTIALS_KEKS 가 필요합니다',
    });
  }
  if (env.NODE_ENV === 'production' && env.CHAT_LLM_ENABLED && !env.LLM_CREDENTIALS_KEKS) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_CREDENTIALS_KEKS'],
      message:
        'production 에서 CHAT_LLM_ENABLED=true 이면 LLM_CREDENTIALS_KEKS 가 필요합니다 (끄려면 CHAT_LLM_ENABLED=false)',
    });
  }
  if (deployed && env.LLM_VENDOR_MODE === 'fake') {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_VENDOR_MODE'],
      message: 'production·VERCEL_ENV 환경에서는 LLM_VENDOR_MODE=fake 를 허용하지 않습니다',
    });
  }
  for (const key of ['LANGSMITH_TRACING', 'LANGCHAIN_TRACING_V2'] as const) {
    if (deployed && isTruthyWord(env[key])) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `production·VERCEL_ENV 환경에서는 ${key} 를 켤 수 없습니다 (외부 트레이싱 금지)`,
      });
    }
  }
}

type EnvShape = z.infer<typeof fullEnvShape>;

/** 키 사이의 제약 (환경별 규칙) */
function checkCrossFieldRules(env: EnvShape, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV === 'production' && env.AUTH_TEST_MODE) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_TEST_MODE'],
      message: 'production 에서는 AUTH_TEST_MODE=true 를 허용하지 않습니다',
    });
  }
  if (env.VERCEL_ENV && env.AUTH_TEST_MODE && !env.AUTH_TEST_MODE_ALLOW_REMOTE) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_TEST_MODE'],
      message: `VERCEL_ENV=${env.VERCEL_ENV} 환경에서는 AUTH_TEST_MODE=true 를 허용하지 않습니다 (예외: AUTH_TEST_MODE_ALLOW_REMOTE=true)`,
    });
  }
  if (env.AUTH_TEST_MODE && !env.AUTH_TEST_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_TEST_PASSWORD'],
      message: 'AUTH_TEST_MODE=true 이면 AUTH_TEST_PASSWORD 가 필요합니다',
    });
  }
  if (env.NODE_ENV === 'production' && env.IMPORT_FAULT_INJECTION) {
    ctx.addIssue({
      code: 'custom',
      path: ['IMPORT_FAULT_INJECTION'],
      message: 'production 에서는 IMPORT_FAULT_INJECTION 을 허용하지 않습니다',
    });
  }
  if (
    env.RATE_LIMIT_BACKEND === 'upstash' &&
    (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_BACKEND'],
      message:
        'RATE_LIMIT_BACKEND=upstash 이면 UPSTASH_REDIS_REST_URL 과 UPSTASH_REDIS_REST_TOKEN 이 필요합니다',
    });
  }
  if (env.DB_DRIVER !== 'pglite' && !env.DATABASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: `DB_DRIVER=${env.DB_DRIVER} 이면 DATABASE_URL 이 필요합니다`,
    });
  }
}

export const envSchema = fullEnvShape.superRefine((env, ctx) => {
  checkCrossFieldRules(env, ctx);
  checkLlmRules(env, ctx);
});

/** 감사 IP 신뢰 프록시 모드. 기본 none — Vercel 에서도 명시(TRUST_PROXY_HEADERS=vercel)해야 켜진다 (§4.8 기본 비신뢰) */
export function proxyTrustMode(env: Pick<EnvShape, 'TRUST_PROXY_HEADERS'>): ProxyTrustMode {
  return env.TRUST_PROXY_HEADERS;
}

export type Env = z.infer<typeof envSchema>;

/** 검증 실패 시 원인을 담아 throw 한다. 기동/빌드 단계에서 즉시 중단되도록 next.config.ts 가 import 한다. */
export function parseEnv(
  source: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn,
): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`환경변수 검증 실패:\n${z.prettifyError(result.error)}`);
  }
  // 운영 기동 검사 (PRAMI-003 §4.3.3) — production 은 위반 하나라도 거부, preview 는 ⓕ·ⓖ 경고
  const target = deployTarget(source);
  if (target) {
    const { errors, warnings } = checkDeployment(source, result.data);
    if (errors.length > 0) {
      throw new Error(`운영 기동 검사 실패 (${target}):\n${formatDeployIssues(target, errors)}`);
    }
    if (warnings.length > 0) {
      warn(`[env] 운영 기동 검사 경고 (${target}):\n${formatDeployIssues(target, warnings)}`);
    }
  }
  return result.data;
}

/** 스키마가 아는 키 전부 — §4.3.2 표·.env.example·docs/deploy/vercel.md 정합 테스트(AC-322)가 쓴다 */
export const ENV_SCHEMA_KEYS: readonly string[] = Object.keys(fullEnvShape.shape);

export const env: Env = parseEnv(process.env);
