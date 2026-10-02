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
  AUTH_REQUIRE_HD: 'true',
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

const PROXY = 'https://prami-preview.example.com/api/auth';

/** preview 권장 설정 (docs/deploy/oauth.md): 리다이렉트 프록시 + AUTH_URL 미설정 */
const VALID_PREVIEW: Record<string, string | undefined> = {
  ...VALID_PRODUCTION,
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_APP_URL: 'https://prami-preview.example.com',
  AUTH_URL: undefined,
  AUTH_REDIRECT_PROXY_URL: PROXY,
};

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
  // PR-2b QA L-N1: Neon 드라이버는 `\` 를 authority 끝으로 봐 localhost·10.0.0.5 로 연결한다
  [
    'e',
    { DATABASE_URL: 'postgresql://app:pw@localhost\\@ep-x.example.neon.tech/prami' },
    /DATABASE_URL/,
  ],
  [
    'e',
    { DATABASE_URL: 'postgresql://app:pw@10.0.0.5\\@ep-x.example.neon.tech/prami' },
    /DATABASE_URL/,
  ],
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
  // ⓚ PRAMI-003 PR-3 OAuth 운영화 (두 환경 공통)
  ['k', { AUTH_REQUIRE_HD: 'false' }, /AUTH_REQUIRE_HD/],
  ['k', { AUTH_REQUIRE_HD: undefined }, /AUTH_REQUIRE_HD/],
];

const patch = (
  base: Record<string, string | undefined>,
  change: Record<string, string | undefined>,
) => {
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
    '규칙 %s 위반 → 거부 (preview)',
    (_rule, change, key) => {
      expect(() => parseEnv(patch(VALID_PREVIEW, change))).toThrowError(key);
    },
  );

  it.each(VIOLATIONS.filter(([rule]) => rule === 'f' || rule === 'g'))(
    '규칙 %s 위반 → 경고만 (변수 이름만)',
    (_rule, change, key) => {
      const warn = vi.fn();
      // ⓕ 는 프록시를 쓰지 않는 preview(고정 호스트만, AUTH_URL 있음)에서 본다 — 프록시가 있으면 ⓚ 가 먼저 거부한다
      const base =
        _rule === 'f'
          ? patch(VALID_PREVIEW, {
              AUTH_REDIRECT_PROXY_URL: undefined,
              AUTH_URL: 'https://prami-preview.example.com',
            })
          : VALID_PREVIEW;
      expect(() => parseEnv(patch(base, change), warn)).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toMatch(key);
      expect(String(warn.mock.calls[0]![0])).not.toContain(SECRET_MARK);
    },
  );
});

describe('ⓚ OAuth 운영화 — 리다이렉트 프록시 (PRAMI-003 §4.4.1)', () => {
  it('preview: 프록시를 쓰면 AUTH_URL 은 없어야 하고 경고도 없다', () => {
    const warn = vi.fn();
    expect(() => parseEnv(VALID_PREVIEW, warn)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('preview: 프록시 + AUTH_URL 동시 설정 → 거부 (배포별 origin 이 사라져 로그인 실패)', () => {
    expect(() =>
      parseEnv({ ...VALID_PREVIEW, AUTH_URL: 'https://prami-preview.example.com' }),
    ).toThrowError(/preview k\].*AUTH_URL/);
  });

  it.each([
    'http://prami-preview.example.com/api/auth',
    'https://prami-preview.example.com/auth',
    'https://prami-preview.example.com/api/auth/callback/google',
    'https://prami-preview.example.com/api/auth?x=1',
  ])('preview: 프록시 형식 위반 %s → 거부', (value) => {
    expect(() => parseEnv({ ...VALID_PREVIEW, AUTH_REDIRECT_PROXY_URL: value })).toThrowError(
      /AUTH_REDIRECT_PROXY_URL/,
    );
  });

  it('preview: 프록시 origin 이 NEXT_PUBLIC_APP_URL(고정 호스트)과 다르면 거부 (콜백 code 유출 방지)', () => {
    expect(() =>
      parseEnv({
        ...VALID_PREVIEW,
        AUTH_REDIRECT_PROXY_URL: 'https://attacker.example.com/api/auth',
      }),
    ).toThrowError(/AUTH_REDIRECT_PROXY_URL NEXT_PUBLIC_APP_URL/);
  });

  // PR #25 QA L-1: 파서가 정규화해 통과하지만 Auth.js 원문 redirect_uri 가 Google 등록값과 달라져 로그인이 깨지는 형태
  it.each([
    `${PROXY}/`,
    'https://u:p@prami-preview.example.com/api/auth',
    `${PROXY}#x`,
    'https://prami-preview.example.com/api/./auth',
    'https://prami-preview.example.com:443/api/auth',
    'https://PRAMI-preview.example.com/api/auth',
  ])('preview: 로그인을 깨는 프록시 형태 %s → 거부', (value) => {
    expect(() => parseEnv({ ...VALID_PREVIEW, AUTH_REDIRECT_PROXY_URL: value })).toThrowError(
      /preview k\].*AUTH_REDIRECT_PROXY_URL/,
    );
  });

  // PR #25 QA L-2: 공백뿐인 값은 스키마에서 undefined 지만 Auth.js 가 원문을 truthy 로 읽는다
  it('production: 공백뿐인 AUTH_REDIRECT_PROXY_URL 도 거부', () => {
    expect(() => parseEnv({ ...VALID_PRODUCTION, AUTH_REDIRECT_PROXY_URL: ' ' })).toThrowError(
      /production k\].*AUTH_REDIRECT_PROXY_URL/,
    );
  });

  it('preview: 공백뿐인 AUTH_REDIRECT_PROXY_URL 은 형식 위반으로 거부', () => {
    expect(() => parseEnv({ ...VALID_PREVIEW, AUTH_REDIRECT_PROXY_URL: ' ' })).toThrowError(
      /preview k\].*AUTH_REDIRECT_PROXY_URL/,
    );
  });

  it.each([
    ['production', VALID_PRODUCTION],
    ['preview', VALID_PREVIEW],
  ] as const)(
    '%s: NEXTAUTH_URL 이 있으면 거부 (AUTH_URL 처럼 origin 을 덮어쓴다)',
    (target, base) => {
      expect(() =>
        parseEnv({ ...base, NEXTAUTH_URL: 'https://prami-preview.example.com' }),
      ).toThrowError(new RegExp(`${target} k\].*NEXTAUTH_URL`));
    },
  );

  it('빈 문자열 AUTH_REDIRECT_PROXY_URL·NEXTAUTH_URL 은 미설정으로 본다 (Auth.js 도 falsy)', () => {
    expect(() =>
      parseEnv({ ...VALID_PRODUCTION, AUTH_REDIRECT_PROXY_URL: '', NEXTAUTH_URL: '' }),
    ).not.toThrow();
  });

  it('production: AUTH_REDIRECT_PROXY_URL 이 있으면 거부 (운영 로그인이 preview 를 거치면 안 됨)', () => {
    expect(() => parseEnv({ ...VALID_PRODUCTION, AUTH_REDIRECT_PROXY_URL: PROXY })).toThrowError(
      /production k\].*AUTH_REDIRECT_PROXY_URL/,
    );
  });

  it('로컬(대상 없음)은 AUTH_REQUIRE_HD=false 가 기본이고 검사하지 않는다', () => {
    expect(parseEnv({}).AUTH_REQUIRE_HD).toBe(false);
  });
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
