import { describe, expect, it } from 'vitest';

import { DB_DRIVERS, parseEnv, proxyTrustMode } from '@/env';

const PG_URL = 'postgres://prami:prami@localhost:5432/prami';

describe('parseEnv — 기본값과 빈 값', () => {
  it('비어 있으면 기본값을 채운다', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(env.DB_DRIVER).toBe('pglite');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.AUTH_TEST_MODE).toBe(false);
    expect(env.AUTH_AUTO_PROVISION).toBe(true);
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(['pentasecurity.com']);
    expect(env.ADMIN_EMAILS).toEqual([]);
  });

  it('.env.example 처럼 빈 문자열이면 미설정으로 취급한다', () => {
    const env = parseEnv({
      DB_DRIVER: '',
      DATABASE_URL: '',
      PGLITE_DATA_DIR: '',
      AUTH_SECRET: '   ',
      AUTH_URL: '',
      AUTH_GOOGLE_ID: '',
      AUTH_TEST_MODE: '',
      AUTH_AUTO_PROVISION: '',
      ADMIN_EMAILS: '',
    });
    expect(env.DB_DRIVER).toBe('pglite');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.PGLITE_DATA_DIR).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
    expect(env.AUTH_TEST_MODE).toBe(false);
    expect(env.AUTH_AUTO_PROVISION).toBe(true);
    expect(env.ADMIN_EMAILS).toEqual([]);
  });

  it('유효한 값은 그대로 통과한다', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      DB_DRIVER: 'neon',
      DATABASE_URL: 'postgresql://user:pw@ep-x.neon.tech/db?sslmode=require',
      AUTH_SECRET: 'x'.repeat(32),
      AUTH_GOOGLE_ID: 'client-id',
      AUTH_GOOGLE_SECRET: 'client-secret',
      NEXT_PUBLIC_APP_URL: 'https://prami.example.com',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.DB_DRIVER).toBe('neon');
    expect(env.NEXT_PUBLIC_APP_URL).toBe('https://prami.example.com');
  });
});

describe('parseEnv — DB 드라이버 (§4.9)', () => {
  it.each(DB_DRIVERS)('%s 드라이버를 허용한다', (driver) => {
    expect(parseEnv({ DB_DRIVER: driver, DATABASE_URL: PG_URL }).DB_DRIVER).toBe(driver);
  });

  it('알 수 없는 드라이버는 거부한다', () => {
    expect(() => parseEnv({ DB_DRIVER: 'mysql' })).toThrowError(/DB_DRIVER/);
  });

  it.each(['pg', 'neon'] as const)('%s 이면 DATABASE_URL 이 필요하다', (driver) => {
    expect(() => parseEnv({ DB_DRIVER: driver })).toThrowError(/DATABASE_URL 이 필요합니다/);
  });

  it('pglite 는 DATABASE_URL 없이 PGLITE_DATA_DIR 만으로 동작한다', () => {
    const env = parseEnv({ DB_DRIVER: 'pglite', PGLITE_DATA_DIR: 'memory://' });
    expect(env.PGLITE_DATA_DIR).toBe('memory://');
  });

  it('URL 형식이 아니면 원인을 담아 throw 한다', () => {
    expect(() => parseEnv({ DATABASE_URL: 'not-a-url' })).toThrowError(/환경변수 검증 실패/);
    expect(() => parseEnv({ DATABASE_URL: 'not-a-url' })).toThrowError(/DATABASE_URL/);
  });
});

describe('parseEnv — 인증 (§4.6.1)', () => {
  it('AUTH_SECRET 이 32자 미만이면 throw 한다', () => {
    expect(() => parseEnv({ AUTH_SECRET: 'short' })).toThrowError(/AUTH_SECRET/);
  });

  it('AUTH_TEST_MODE=true 는 비-production 에서 AUTH_TEST_PASSWORD 와 함께 허용된다', () => {
    const env = parseEnv({ NODE_ENV: 'test', AUTH_TEST_MODE: 'true', AUTH_TEST_PASSWORD: 'pw' });
    expect(env.AUTH_TEST_MODE).toBe(true);
    expect(env.AUTH_TEST_PASSWORD).toBe('pw');
  });

  it('AUTH_TEST_MODE=true 인데 AUTH_TEST_PASSWORD 가 없으면 throw 한다', () => {
    expect(() => parseEnv({ AUTH_TEST_MODE: 'true' })).toThrowError(/AUTH_TEST_PASSWORD/);
  });

  it('production 에서는 AUTH_TEST_MODE=true 를 거부한다', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'production', AUTH_TEST_MODE: 'true', AUTH_TEST_PASSWORD: 'pw' }),
    ).toThrowError(/production 에서는 AUTH_TEST_MODE/);
  });

  it.each([
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
  ])('불리언 문자열 %s → %s', (raw, expected) => {
    expect(parseEnv({ AUTH_AUTO_PROVISION: raw }).AUTH_AUTO_PROVISION).toBe(expected);
  });

  it('불리언으로 해석할 수 없는 값은 거부한다', () => {
    expect(() => parseEnv({ AUTH_AUTO_PROVISION: 'maybe' })).toThrowError(/AUTH_AUTO_PROVISION/);
  });

  it('쉼표 구분 목록을 배열로 파싱한다 (공백·빈 항목 제거)', () => {
    const env = parseEnv({
      ALLOWED_EMAIL_DOMAINS: 'pentasecurity.com, example.com,,',
      ADMIN_EMAILS: ' admin@pentasecurity.com ,ops@pentasecurity.com',
    });
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(['pentasecurity.com', 'example.com']);
    expect(env.ADMIN_EMAILS).toEqual(['admin@pentasecurity.com', 'ops@pentasecurity.com']);
  });

  it('ADMIN_EMAILS 에 이메일 형식이 아닌 항목이 있으면 throw 한다', () => {
    expect(() => parseEnv({ ADMIN_EMAILS: 'not-an-email' })).toThrowError(/ADMIN_EMAILS/);
  });

  it('NODE_ENV 는 세 값만 허용한다', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
  });
});

describe('parseEnv — PR-3 추가 키', () => {
  it('IMPORT_FAULT_INJECTION 은 단계 이름만, production 에서는 거부', () => {
    expect(parseEnv({ IMPORT_FAULT_INJECTION: 'load' }).IMPORT_FAULT_INJECTION).toBe('load');
    expect(() => parseEnv({ IMPORT_FAULT_INJECTION: 'nope' })).toThrowError(
      /IMPORT_FAULT_INJECTION/,
    );
    expect(() => parseEnv({ NODE_ENV: 'production', IMPORT_FAULT_INJECTION: 'load' })).toThrowError(
      /production 에서는 IMPORT_FAULT_INJECTION/,
    );
  });

  it('TRUST_PROXY_HEADERS: 기본 none(Vercel 에서도 명시해야 신뢰), vercel·generic, true/false 호환 (§4.8, AC-93 구조)', () => {
    expect(proxyTrustMode(parseEnv({}))).toBe('none');
    expect(proxyTrustMode(parseEnv({ VERCEL: '1' }))).toBe('none');
    expect(proxyTrustMode(parseEnv({ TRUST_PROXY_HEADERS: 'vercel' }))).toBe('vercel');
    expect(proxyTrustMode(parseEnv({ TRUST_PROXY_HEADERS: 'VERCEL' }))).toBe('vercel');
    expect(proxyTrustMode(parseEnv({ TRUST_PROXY_HEADERS: 'generic' }))).toBe('generic');
    expect(proxyTrustMode(parseEnv({ TRUST_PROXY_HEADERS: 'true' }))).toBe('generic');
    expect(proxyTrustMode(parseEnv({ TRUST_PROXY_HEADERS: 'false' }))).toBe('none');
    expect(() => parseEnv({ TRUST_PROXY_HEADERS: 'cloudflare' })).toThrowError(
      /TRUST_PROXY_HEADERS/,
    );
  });

  it('AC-94 ②: VERCEL_ENV 가 정의되면 AUTH_TEST_MODE=true 기동 거부 (예외: AUTH_TEST_MODE_ALLOW_REMOTE=true)', () => {
    const testMode = { AUTH_TEST_MODE: 'true', AUTH_TEST_PASSWORD: 'local-only-password' };
    for (const vercelEnv of ['preview', 'production', 'development']) {
      expect(() => parseEnv({ ...testMode, VERCEL_ENV: vercelEnv })).toThrowError(
        new RegExp(`VERCEL_ENV=${vercelEnv} 환경에서는 AUTH_TEST_MODE=true 를 허용하지 않습니다`),
      );
    }
    expect(
      parseEnv({ ...testMode, VERCEL_ENV: 'preview', AUTH_TEST_MODE_ALLOW_REMOTE: 'true' })
        .AUTH_TEST_MODE,
    ).toBe(true);
    expect(parseEnv({ VERCEL_ENV: 'preview' }).AUTH_TEST_MODE).toBe(false);
    expect(parseEnv(testMode).AUTH_TEST_MODE).toBe(true);
  });

  it('AUTH_TEST_ALLOWED_HOSTS 기본 localhost·127.0.0.1, 쉼표 목록', () => {
    expect(parseEnv({}).AUTH_TEST_ALLOWED_HOSTS).toEqual(['localhost', '127.0.0.1']);
    expect(
      parseEnv({ AUTH_TEST_ALLOWED_HOSTS: ' prami.local , 10.0.0.5 ' }).AUTH_TEST_ALLOWED_HOSTS,
    ).toEqual(['prami.local', '10.0.0.5']);
  });

  it('RATE_LIMIT_PER_MIN 기본 30, 양의 정수만 (§4.8 r6)', () => {
    expect(parseEnv({}).RATE_LIMIT_PER_MIN).toBe(30);
    expect(parseEnv({ RATE_LIMIT_PER_MIN: '1000' }).RATE_LIMIT_PER_MIN).toBe(1000);
    expect(() => parseEnv({ RATE_LIMIT_PER_MIN: '0' })).toThrowError(/RATE_LIMIT_PER_MIN/);
    expect(() => parseEnv({ RATE_LIMIT_PER_MIN: 'abc' })).toThrowError(/RATE_LIMIT_PER_MIN/);
  });
});
