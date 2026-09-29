import { z } from 'zod';

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

const envShape = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.preprocess(emptyToUndefined, z.url().default('http://localhost:3000')),

  // ── DB (§4.9) ──────────────────────────────────────────────────────────
  /** neon: Vercel / pg: 로컬 Docker Postgres·QA·CI e2e / pglite: 단위·통합 테스트(인프로세스). 미설정 시 pglite */
  DB_DRIVER: z.preprocess(emptyToUndefined, z.enum(DB_DRIVERS).default('pglite')),
  DATABASE_URL: optionalUrl,
  PGLITE_DATA_DIR: optionalString,

  // ── 인증 (§4.6.1, Auth.js v5 Google) ───────────────────────────────────
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  AUTH_URL: optionalUrl,
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

  // ── rate limit (§4.8 r6, AC-95) ────────────────────────────────────────
  /** 엔드포인트별 키(사용자/IP)당 분당 상한. 기본 30, 테스트 1000 — 표는 src/server/rate-limit.ts · docs/deploy/vercel.md */
  RATE_LIMIT_PER_MIN: positiveIntFromString(30),

  // ── 임포트 (§4.4) ──────────────────────────────────────────────────────
  /** QA-03e 실패 주입: 지정 단계 이후 예외 (items|manual|load|recompute|verify). production 에서는 거부 */
  IMPORT_FAULT_INJECTION: z.preprocess(
    emptyToUndefined,
    z.enum(['items', 'manual', 'load', 'recompute', 'verify']).optional(),
  ),
});

type EnvShape = z.infer<typeof envShape>;

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
  if (env.DB_DRIVER !== 'pglite' && !env.DATABASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: `DB_DRIVER=${env.DB_DRIVER} 이면 DATABASE_URL 이 필요합니다`,
    });
  }
}

export const envSchema = envShape.superRefine(checkCrossFieldRules);

/** 감사 IP 신뢰 프록시 모드. 기본 none — Vercel 에서도 명시(TRUST_PROXY_HEADERS=vercel)해야 켜진다 (§4.8 기본 비신뢰) */
export function proxyTrustMode(env: Pick<EnvShape, 'TRUST_PROXY_HEADERS'>): ProxyTrustMode {
  return env.TRUST_PROXY_HEADERS;
}

export type Env = z.infer<typeof envSchema>;

/** 검증 실패 시 원인을 담아 throw 한다. 기동/빌드 단계에서 즉시 중단되도록 next.config.ts 가 import 한다. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`환경변수 검증 실패:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
