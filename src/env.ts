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

/** 미설정이면 undefined (호출자가 환경에 따라 기본값을 정한다) */
const optionalBooleanFromString = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : parseBooleanWord(value)),
  z.boolean().optional(),
);

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
  ALLOWED_EMAIL_DOMAINS: csvList(z.string().min(1), ['pentasecurity.com']),
  ADMIN_EMAILS: csvList(z.email(), []),
  AUTH_AUTO_PROVISION: booleanFromString(true),

  // ── 요청 출처 (감사 로그 IP) ────────────────────────────────────────────
  /**
   * x-forwarded-for / x-real-ip 를 신뢰할지. 신뢰할 프록시(Vercel 등) 뒤에서만 true.
   * 미설정 시 Vercel 환경(VERCEL=1)이면 true, 그 외(로컬 직접 노출)는 false → 위조 가능한 헤더를 IP 로 기록하지 않음
   */
  TRUST_PROXY_HEADERS: optionalBooleanFromString,
  VERCEL: optionalString,

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

/** 프록시 헤더 신뢰 여부 (명시값 우선, 없으면 Vercel 여부) */
export function trustsProxyHeaders(env: Pick<EnvShape, 'TRUST_PROXY_HEADERS' | 'VERCEL'>): boolean {
  return env.TRUST_PROXY_HEADERS ?? env.VERCEL === '1';
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
