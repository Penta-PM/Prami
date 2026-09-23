import { describe, expect, it } from 'vitest';

import { DB_DRIVERS, parseEnv, trustsProxyHeaders } from '@/env';

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

  it('TRUST_PROXY_HEADERS: 명시값 우선, 미설정이면 Vercel 에서만 신뢰', () => {
    expect(trustsProxyHeaders(parseEnv({}))).toBe(false);
    expect(trustsProxyHeaders(parseEnv({ VERCEL: '1' }))).toBe(true);
    expect(trustsProxyHeaders(parseEnv({ VERCEL: '1', TRUST_PROXY_HEADERS: 'false' }))).toBe(false);
    expect(trustsProxyHeaders(parseEnv({ TRUST_PROXY_HEADERS: 'true' }))).toBe(true);
  });
});
