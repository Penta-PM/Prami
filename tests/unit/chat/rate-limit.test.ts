import { describe, expect, it } from 'vitest';

import {
  createRateLimiter,
  ipScopeFor,
  rateLimitedResponse,
  rateLimiters,
  rateLimitIp,
  RATE_LIMIT_DEFAULT,
  retryAfterSeconds,
} from '@/server/rate-limit';

/** 속도 제한 단일 모듈 (§4.8 r6, AC-95): 슬라이딩 윈도우·버킷 분리·IP 키·429 봉투 */
describe('createRateLimiter', () => {
  it('상한까지 허용하고 그 다음은 거부, 창이 지나면 다시 허용, 키별 독립', () => {
    const limiter = createRateLimiter('t', 3, 1000);
    expect(limiter.hit('u1', 0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.hit('u1', 100)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.hit('u1', 200)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.hit('u1', 300)).toMatchObject({ allowed: false, retryAfterMs: 700 });
    expect(limiter.hit('u2', 300)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.hit('u1', 1001)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.hit('u1', 1002)).toMatchObject({ allowed: false });
    limiter.reset();
    expect(limiter.hit('u1', 1003)).toMatchObject({ allowed: true, remaining: 2 });
    limiter.configure(1);
    expect(limiter.limit()).toBe(1);
    expect(limiter.hit('u1', 1004).allowed).toBe(false);
  });

  it('기본 상한 30, 테스트 env 는 1000 (§4.9.2 r6), 엔드포인트별 버킷이 따로다', () => {
    expect(RATE_LIMIT_DEFAULT).toBe(30);
    expect(rateLimiters.chat.limit()).toBe(1000);
    const names = Object.values(rateLimiters).map((limiter) => limiter.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('retryAfterSeconds 는 올림·최소 1초', () => {
    expect(retryAfterSeconds({ allowed: false, remaining: 0, retryAfterMs: 1 })).toBe(1);
    expect(retryAfterSeconds({ allowed: false, remaining: 0, retryAfterMs: 59_001 })).toBe(60);
  });
});

describe('ipScopeFor / rateLimitIp / rateLimitedResponse', () => {
  it('공유 페이지·PDF(GET)·auth 콜백만 IP 버킷', () => {
    expect(ipScopeFor('/share/quotes/abc', 'GET')).toBe('share');
    expect(ipScopeFor('/api/quotes/0f0/pdf', 'GET')).toBe('pdf');
    expect(ipScopeFor('/api/quotes/0f0/pdf', 'POST')).toBeNull();
    expect(ipScopeFor('/api/auth/callback/google', 'GET')).toBe('authCallback');
    expect(ipScopeFor('/api/auth/callback/test', 'POST')).toBe('authCallback');
    expect(ipScopeFor('/api/auth/session', 'GET')).toBeNull();
    expect(ipScopeFor('/calculator', 'GET')).toBeNull();
  });

  it('IP 키: 신뢰 모드면 audit 규칙, 아니면 XFF 오른쪽 끝(Next 가 덧붙인 소켓 주소), 없으면 unknown', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4, 10.0.0.7',
      'x-vercel-forwarded-for': '203.0.113.9',
    });
    expect(rateLimitIp(headers, 'none')).toBe('10.0.0.7');
    expect(rateLimitIp(headers, 'vercel')).toBe('203.0.113.9');
    expect(rateLimitIp(new Headers(), 'none')).toBe('unknown');
  });

  it('429 봉투 + Retry-After + no-store', async () => {
    const response = rateLimitedResponse({ allowed: false, remaining: 0, retryAfterMs: 12_300 });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('13');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: '요청이 너무 잦습니다. 13초 후 다시 시도하세요',
        details: { retryAfterSeconds: 13 },
      },
    });
  });
});
