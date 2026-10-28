// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { requestMetaFromHeaders, trustedClientIp } from '@/server/audit/log';
import { guardTestLogin, hostnameOf, isAllowedTestHost } from '@/server/auth/test-mode-guard';
import { formatLog, logger, MASK, maskString, maskValue } from '@/server/log';
import { createRateLimiter } from '@/server/rate-limit';
import {
  buildCsp,
  createNonce,
  resolveRequestId,
  STATIC_SECURITY_HEADERS,
} from '@/server/security/headers';

import { auditByAction, createTestDb } from '../../helpers/pglite';

/** PR-11a 하드닝 순수 모듈: CSP·정적 헤더(AC-91), 요청 ID, 구조화 로그 마스킹, 테스트 모드 Host 검사(AC-94 ①), 감사 IP 신뢰 모드(AC-93 구조) */
describe('buildCsp / STATIC_SECURITY_HEADERS (AC-91)', () => {
  it('script 는 nonce + strict-dynamic 만 (unsafe-inline 없음), frame-ancestors none, 로컬 http 에선 upgrade 없음', () => {
    const csp = buildCsp({ nonce: 'abc123', isDev: false, isHttps: false });
    const script = csp.split('; ').find((part) => part.startsWith('script-src'))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://accounts.google.com");
    // Pretendard 셀프 호스트(Penta 토큰 PR-1) — 외부 폰트·스타일 출처 없음
    expect(csp).not.toContain('jsdelivr');
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("font-src 'self' data:;");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it("개발 모드만 'unsafe-eval'·ws:, https 공개 URL 이면 upgrade-insecure-requests", () => {
    const dev = buildCsp({ nonce: 'n', isDev: true, isHttps: false });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' ws: wss:");
    expect(buildCsp({ nonce: 'n', isDev: false, isHttps: true })).toContain(
      'upgrade-insecure-requests',
    );
  });

  it('정적 헤더: HSTS·X-Frame-Options DENY·nosniff·Referrer-Policy·Permissions-Policy', () => {
    const headers = Object.fromEntries(
      STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value]),
    );
    expect(headers['Strict-Transport-Security']).toMatch(/^max-age=\d{8,}; includeSubDomains/);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });

  it('nonce 는 요청마다 다르고, 요청 ID 는 안전한 형식만 이어 쓴다', () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(resolveRequestId('abcd-1234-efgh')).toBe('abcd-1234-efgh');
    expect(resolveRequestId('bad id\nINJECT')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('구조화 로그 마스킹', () => {
  it('비밀 키 이름은 통째로, URL userinfo·Bearer 토큰은 값 안에서 가린다', () => {
    const url = ['postgres://prami:', 'topsecret', '@localhost:5432/prami'].join('');
    expect(maskString(`connect ${url} failed`)).toBe(
      `connect postgres://prami:${MASK}@localhost:5432/prami failed`,
    );
    expect(maskString('Authorization: Bearer abcdefghijklmnop')).toBe(
      `Authorization: Bearer ${MASK}`,
    );
    expect(
      maskValue({
        password: 'x',
        nested: { authToken: 'y', cookie: 'z', ok: 'keep' },
        list: [url],
      }),
    ).toEqual({
      password: MASK,
      nested: { authToken: MASK, cookie: MASK, ok: 'keep' },
      list: [`postgres://prami:${MASK}@localhost:5432/prami`],
    });
  });

  it('Error 는 이름·메시지·코드·스택 앞부분·원인으로 직렬화하고, 한 줄 JSON 으로 쓴다', () => {
    const cause = new Error(['DATABASE_URL=postgres://u:', 'pw123456', '@h/db'].join(''));
    const error = Object.assign(new Error('boom', { cause }), { code: '23505' });
    const record = formatLog('error', 'request.failed', { requestId: 'r-1', error });
    expect(record).toMatchObject({
      level: 'error',
      event: 'request.failed',
      requestId: 'r-1',
      error: { name: 'Error', message: 'boom', code: '23505' },
    });
    expect(JSON.stringify(record)).not.toContain('pw123456');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('x.failed', { requestId: 'r-2', secret: 's' });
    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'error',
      event: 'x.failed',
      requestId: 'r-2',
      secret: MASK,
    });
    spy.mockRestore();
  });
});

describe('감사 IP 신뢰 모드 (AC-93 로컬 구조, 위조 XFF)', () => {
  const forged = new Headers({
    'x-forwarded-for': '1.2.3.4',
    'x-real-ip': '198.51.100.20',
    'x-vercel-forwarded-for': '203.0.113.5',
    'user-agent': 'ua',
  });

  it('none(기본): 위조 가능한 헤더를 전혀 쓰지 않는다 → ip null', () => {
    expect(requestMetaFromHeaders(forged, 'none')).toEqual({ ip: null, userAgent: 'ua' });
  });

  it('vercel: x-vercel-forwarded-for → x-real-ip 순, x-forwarded-for(1.2.3.4)는 절대 안 쓴다', () => {
    expect(trustedClientIp(forged, 'vercel')).toBe('203.0.113.5');
    const noVercel = new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '198.51.100.20' });
    expect(trustedClientIp(noVercel, 'vercel')).toBe('198.51.100.20');
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }), 'vercel')).toBeNull();
  });

  it('generic: x-real-ip → XFF 오른쪽 끝, boolean true/false 는 generic/none', () => {
    expect(trustedClientIp(forged, 'generic')).toBe('198.51.100.20');
    const chained = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' });
    expect(requestMetaFromHeaders(chained, true).ip).toBe('203.0.113.7');
    expect(requestMetaFromHeaders(chained, false).ip).toBeNull();
  });
});

describe('테스트 모드 Host 검사 (AC-94 ①)', () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it('hostnameOf: 포트·IPv6 대괄호 제거, 소문자', () => {
    expect(hostnameOf('LocalHost:3000')).toBe('localhost');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:3000')).toBe('::1');
    expect(hostnameOf('::1')).toBe('::1');
    expect(hostnameOf('')).toBeNull();
    expect(hostnameOf(null)).toBeNull();
  });

  it('isAllowedTestHost: 목록의 호스트명만 (포트 무관, 접미사 속임 불가)', () => {
    const allowed = ['localhost', '127.0.0.1'];
    expect(isAllowedTestHost('localhost:3000', allowed)).toBe(true);
    expect(isAllowedTestHost('127.0.0.1:3100', allowed)).toBe(true);
    expect(isAllowedTestHost('192.168.0.10:3000', allowed)).toBe(false);
    expect(isAllowedTestHost('localhost.evil.example', allowed)).toBe(false);
    expect(isAllowedTestHost(null, allowed)).toBe(false);
  });

  it('목록 밖 Host → test_mode_host + 감사 1행(denied), 목록 안 → ok, 시도 과다 → rate_limited', async () => {
    const limiter = createRateLimiter('t', 2);
    const base = {
      db: handle.db,
      email: 'Fixture-User@pentasecurity.com',
      allowedHosts: ['localhost'],
      limiter,
      meta: { ip: null, userAgent: 'vitest' },
    };
    expect(await guardTestLogin({ ...base, host: '192.168.0.10:3000' })).toBe('test_mode_host');
    expect(await auditByAction(handle, 'auth.denied_test_mode')).toEqual([
      expect.objectContaining({
        actorUserId: null,
        actorLabel: 'Fixture-User@pentasecurity.com',
        targetType: 'host',
        targetId: '192.168.0.10',
        result: 'denied',
      }),
    ]);
    expect(await guardTestLogin({ ...base, host: 'localhost:3000' })).toBe('ok');
    expect(await guardTestLogin({ ...base, host: 'localhost:3000' })).toBe('ok');
    // 이메일 대소문자는 같은 버킷
    expect(
      await guardTestLogin({ ...base, email: 'fixture-user@pentasecurity.com', host: 'localhost' }),
    ).toBe('rate_limited');
    // 거부된 Host 시도는 버킷을 쓰지 않는다 (감사만)
    expect(await auditByAction(handle, 'auth.denied_test_mode')).toHaveLength(1);
  });
});
