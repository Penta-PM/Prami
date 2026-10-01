import { describe, expect, it, vi } from 'vitest';

import { parseEnv } from '@/env';
import { checkDeployment, deployTarget, isDeployedEnvironment } from '@/env-deploy';
import { dbHostOf, isLocalDbHost, isPrivateDbHost } from '@/lib/db-host';

/**
 * PRAMI-003 §4.3.3 운영 기동 검사 (AC-321). 규칙마다 위반·통과 쌍. 값은 전부 더미이며 오류 메시지에 값이 없어야 한다.
 */
const KEK = `1:${Buffer.alloc(32, 'deploy-test').toString('base64')}`;
const SECRET_MARK = 'dummy-secret-value-should-not-leak';

const VALID_PRODUCTION: Record<string, string> = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_APP_URL: 'https://prami.example.com',
  AUTH_URL: 'https://prami.example.com',
  DB_DRIVER: 'neon',
  DATABASE_URL: ['postgresql://app:', SECRET_MARK, '@ep-x-pooler.example.neon.tech/prami'].join(''),
  AUTH_SECRET: 'x'.repeat(40),
  AUTH_GOOGLE_ID: 'dummy-client-id',
  AUTH_GOOGLE_SECRET: SECRET_MARK,
  ADMIN_EMAILS: 'admin@pentasecurity.com',
  TRUST_PROXY_HEADERS: 'vercel',
  RATE_LIMIT_BACKEND: 'upstash',
  UPSTASH_REDIS_REST_URL: 'https://example-upstash.example.com',
  UPSTASH_REDIS_REST_TOKEN: SECRET_MARK,
  LLM_CREDENTIALS_KEKS: KEK,
  LLM_CREDENTIALS_ACTIVE_KEK: '1',
};

const VALID_PREVIEW = { ...VALID_PRODUCTION, VERCEL_ENV: 'preview' };

type Case = [rule: string, patch: Record<string, string | undefined>, key: RegExp];

/** 규칙별 위반 주입 (§4.3.3 ⓐ~ⓙ + PRAMI_ALLOW_SEED) */
const VIOLATIONS: Case[] = [
  ['a', { AUTH_TEST_MODE: 'false' }, /AUTH_TEST_MODE/],
  ['a', { AUTH_TEST_PASSWORD: 'pw' }, /AUTH_TEST_PASSWORD/],
  ['a', { AUTH_TEST_MODE_ALLOW_REMOTE: 'false' }, /AUTH_TEST_MODE_ALLOW_REMOTE/],
  ['b', { IMPORT_FAULT_INJECTION: 'load' }, /IMPORT_FAULT_INJECTION/],
  ['c', { LLM_VENDOR_MODE: 'fake' }, /LLM_VENDOR_MODE/],
  ['c', { LANGSMITH_TRACING: 'true' }, /LANGSMITH_TRACING/],
  ['d', { TRUST_PROXY_HEADERS: 'none' }, /TRUST_PROXY_HEADERS/],
  ['d', { TRUST_PROXY_HEADERS: undefined }, /TRUST_PROXY_HEADERS/],
  ['e', { DB_DRIVER: 'pg' }, /DB_DRIVER/],
  ['e', { DATABASE_URL: 'postgresql://app:pw@localhost:5432/prami' }, /DATABASE_URL/],
  ['e', { DATABASE_URL: 'postgresql://app:pw@10.1.2.3:5432/prami' }, /DATABASE_URL/],
  ['e', { DATABASE_URL: 'postgresql://app:pw@192.168.0.9:5432/prami' }, /DATABASE_URL/],
  // QA M-1: 실제 연결 호스트를 바꾸는 쿼리·판정 불가 형식은 거부 (fail-closed)
  [
    'e',
    { DATABASE_URL: 'postgresql://app:pw@ep-x.example.neon.tech/prami?host=localhost' },
    /DATABASE_URL/,
  ],
  ['e', { DATABASE_URL: 'postgresql://app:pw@[::ffff:127.0.0.1]/prami' }, /DATABASE_URL/],
  ['e', { DATABASE_URL: 'postgresql://app:pw@127.1/prami' }, /DATABASE_URL/],
  ['e', { DATABASE_URL: 'postgresql://app:pw@10.0.0.5./prami' }, /DATABASE_URL/],
  ['f', { NEXT_PUBLIC_APP_URL: 'http://prami.example.com' }, /NEXT_PUBLIC_APP_URL/],
  ['f', { AUTH_URL: undefined }, /AUTH_URL/],
  ['g', { ADMIN_EMAILS: '' }, /ADMIN_EMAILS/],
  ['h', { AUTH_SECRET: undefined }, /AUTH_SECRET/],
  ['h', { AUTH_GOOGLE_ID: '' }, /AUTH_GOOGLE_ID/],
  ['h', { AUTH_GOOGLE_SECRET: undefined }, /AUTH_GOOGLE_SECRET/],
  ['i', { RATE_LIMIT_BACKEND: 'memory' }, /RATE_LIMIT_BACKEND/],
  [
    'j',
    { LLM_CREDENTIALS_KEKS: undefined, LLM_CREDENTIALS_ACTIVE_KEK: undefined },
    /LLM_CREDENTIALS_KEKS/,
  ],
  ['seed', { PRAMI_ALLOW_SEED: '1' }, /PRAMI_ALLOW_SEED/],
];

const patch = (base: Record<string, string>, change: Record<string, string | undefined>) => {
  const next: Record<string, string | undefined> = { ...base, ...change };
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete next[key];
  return next;
};

describe('운영 기동 검사 — production (AC-321)', () => {
  it('전부 충족한 설정은 통과한다', () => {
    const env = parseEnv(VALID_PRODUCTION);
    expect(env.RATE_LIMIT_BACKEND).toBe('upstash');
  });

  it.each(VIOLATIONS)('규칙 %s 위반 → 기동 거부 (%o)', (rule, change, key) => {
    const run = () => parseEnv(patch(VALID_PRODUCTION, change));
    expect(run).toThrowError(key);
    try {
      run();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(SECRET_MARK);
      expect(message).not.toContain('10.1.2.3');
      // b·c·j 는 기존(PRAMI-001/002) NODE_ENV=production 스키마 규칙이 먼저 잡는다 — 거부 자체가 요건
      if (!['b', 'c', 'j'].includes(rule)) expect(message).toContain(`production ${rule}]`);
    }
  });

  it('memory 백엔드는 위험 수용 플래그가 있으면 허용된다', () => {
    const env = parseEnv(
      patch(VALID_PRODUCTION, {
        RATE_LIMIT_BACKEND: 'memory',
        RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION: 'true',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      }),
    );
    expect(env.RATE_LIMIT_BACKEND).toBe('memory');
  });

  it('CHAT_LLM_ENABLED=false 면 KEK 없이도 통과한다 (ⓙ)', () => {
    expect(() =>
      parseEnv(
        patch(VALID_PRODUCTION, {
          CHAT_LLM_ENABLED: 'false',
          LLM_CREDENTIALS_KEKS: undefined,
          LLM_CREDENTIALS_ACTIVE_KEK: undefined,
        }),
      ),
    ).not.toThrow();
  });

  it('NODE_ENV=production ∧ APP_ENV=production(자체 호스팅)도 production 규칙을 적용한다', () => {
    const selfHosted = patch(VALID_PRODUCTION, { VERCEL_ENV: undefined, APP_ENV: 'production' });
    expect(() => parseEnv(selfHosted)).not.toThrow();
    expect(() => parseEnv({ ...selfHosted, TRUST_PROXY_HEADERS: 'none' })).toThrowError(
      /TRUST_PROXY_HEADERS/,
    );
  });

  it('APP_ENV 없이 NODE_ENV=production 만이면(로컬·CI 빌드) 운영 규칙을 적용하지 않는다', () => {
    expect(() => parseEnv({ NODE_ENV: 'production', CHAT_LLM_ENABLED: 'false' })).not.toThrow();
  });
});

describe('운영 기동 검사 — preview (§4.3.3: ⓕ·ⓖ 경고, 나머지 거부)', () => {
  it('충족한 설정은 경고 없이 통과한다', () => {
    const warn = vi.fn();
    parseEnv(VALID_PREVIEW, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(VIOLATIONS.filter(([rule]) => rule !== 'f' && rule !== 'g'))(
    '규칙 %s 위반 → 거부',
    (_rule, change, key) => {
      expect(() => parseEnv(patch(VALID_PREVIEW, change))).toThrowError(key);
    },
  );

  it.each(VIOLATIONS.filter(([rule]) => rule === 'f' || rule === 'g'))(
    '규칙 %s 위반 → 경고만 (변수 이름만)',
    (_rule, change, key) => {
      const warn = vi.fn();
      expect(() => parseEnv(patch(VALID_PREVIEW, change), warn)).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toMatch(key);
      expect(String(warn.mock.calls[0]![0])).not.toContain(SECRET_MARK);
    },
  );
});

describe('deployTarget · checkDeployment', () => {
  it('대상 판정', () => {
    expect(deployTarget({ VERCEL_ENV: 'production' })).toBe('production');
    expect(deployTarget({ VERCEL_ENV: 'preview' })).toBe('preview');
    expect(deployTarget({ VERCEL_ENV: 'development' })).toBeNull();
    // QA L-1: 대소문자·공백 무시, 알 수 없는 VERCEL_ENV 는 preview 로 (검사 생략 방지)
    expect(deployTarget({ VERCEL_ENV: ' PRODUCTION ' })).toBe('production');
    expect(deployTarget({ VERCEL_ENV: 'Preview' })).toBe('preview');
    expect(deployTarget({ VERCEL_ENV: 'staging' })).toBe('preview');
    expect(deployTarget({ VERCEL_ENV: 'Development' })).toBeNull();
    expect(deployTarget({ VERCEL_ENV: '  ' })).toBeNull();
    expect(deployTarget({ NODE_ENV: 'production', APP_ENV: 'Production' })).toBe('production');
    expect(deployTarget({ NODE_ENV: 'production' })).toBeNull();
    expect(deployTarget({ NODE_ENV: 'production', APP_ENV: 'production' })).toBe('production');
    expect(deployTarget({})).toBeNull();
  });

  it('isDeployedEnvironment: Vercel 전 환경 + 자체 호스팅 production', () => {
    expect(isDeployedEnvironment({ VERCEL_ENV: 'development' })).toBe(true);
    expect(isDeployedEnvironment({ NODE_ENV: 'production', APP_ENV: 'production' })).toBe(true);
    expect(isDeployedEnvironment({ NODE_ENV: 'production' })).toBe(false);
    expect(isDeployedEnvironment({})).toBe(false);
  });

  it('로컬(대상 없음)은 아무것도 검사하지 않는다', () => {
    const env = parseEnv({});
    expect(checkDeployment({}, env)).toEqual({ errors: [], warnings: [] });
  });

  it('upstash 백엔드는 어느 환경에서든 URL·토큰이 필요하다', () => {
    expect(() => parseEnv({ RATE_LIMIT_BACKEND: 'upstash' })).toThrowError(
      /UPSTASH_REDIS_REST_URL/,
    );
    expect(() =>
      parseEnv({
        RATE_LIMIT_BACKEND: 'upstash',
        UPSTASH_REDIS_REST_URL: 'https://x.example.com',
        UPSTASH_REDIS_REST_TOKEN: 't',
      }),
    ).not.toThrow();
  });
});

describe('db-host', () => {
  it('호스트 추출·판정', () => {
    expect(dbHostOf('postgres://u:pw@LocalHost:5432/x')).toBe('localhost');
    expect(dbHostOf('postgres://u:pw@[::1]:5432/x')).toBe('::1');
    expect(dbHostOf('not a url')).toBeNull();
    expect(dbHostOf(undefined)).toBeNull();
    expect(isLocalDbHost('postgres')).toBe(true);
    expect(isLocalDbHost('example-remote-host')).toBe(false);
    expect(isLocalDbHost(null)).toBe(false);
    expect(isPrivateDbHost('172.20.0.2')).toBe(true);
    expect(isPrivateDbHost('172.32.0.2')).toBe(false);
    expect(isPrivateDbHost('fd12:3456::1')).toBe(true);
    expect(isPrivateDbHost('ep-x.neon.tech')).toBe(false);
    expect(isPrivateDbHost(null)).toBe(false);
  });
});
