// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRateLimiter,
  createUpstashRateLimiter,
  ipScopeFor,
  rateLimitBackendStatus,
  rateLimitIpKey,
  SHARED_RATE_LIMIT_KEY,
} from '@/server/rate-limit';
import {
  BACKEND_ERROR_ESCALATE_COUNT,
  createBackendErrorReporter,
  upstashPing,
  UpstashError,
} from '@/server/rate-limit-upstash';

import { createUpstashDouble } from '../../helpers/upstash-double';

/**
 * PRAMI-003 §4.3.7 분산 rate limit — AC-328(인스턴스 2개 합산·키 접두·IP HMAC), AC-329(장애 fallback·로그 수준).
 * 실 Upstash 호출 없음: Upstash REST 호환 테스트 더블(tests/helpers/upstash-double.ts).
 */
const TOKEN = 'test-upstash-token';
const config = (double: ReturnType<typeof createUpstashDouble>) => ({
  url: 'https://upstash-double.example.com',
  token: TOKEN,
  envName: 'preview',
  fetch: double.fetch,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Upstash 백엔드 — 인스턴스 간 합산 (AC-328)', () => {
  it('서로 다른 인스턴스 2개가 같은 키를 공유하면 합산 31번째가 429 다', async () => {
    const double = createUpstashDouble(TOKEN);
    const a = createUpstashRateLimiter('chat', 30, { config: config(double) });
    const b = createUpstashRateLimiter('chat', 30, { config: config(double) });
    const decisions = [];
    for (let i = 0; i < 31; i += 1) {
      decisions.push(await (i % 2 === 0 ? a : b).hit('user-1', 1_000 + i));
    }
    expect(decisions.slice(0, 30).every((decision) => decision.allowed)).toBe(true);
    expect(decisions[29]!.remaining).toBe(0);
    expect(decisions[30]).toMatchObject({ allowed: false, remaining: 0 });
    expect(decisions[30]!.retryAfterMs).toBe(60_000 - 30);
    // 거부된 요청은 세지 않는다 — 창이 지나면 다시 허용
    expect(await a.hit('user-1', 1_000 + 60_000)).toMatchObject({ allowed: true });
    expect(await b.hit('user-2', 1_031)).toMatchObject({ allowed: true, remaining: 29 });
  });

  it('memory 백엔드는 인스턴스별이다 (기존 동작)', async () => {
    const a = createRateLimiter('chat', 2, 60_000);
    const b = createRateLimiter('chat', 2, 60_000);
    await a.hit('k', 0);
    await a.hit('k', 1);
    expect((await a.hit('k', 2)).allowed).toBe(false);
    expect((await b.hit('k', 2)).allowed).toBe(true);
    expect(a.backend).toBe('memory');
  });

  it('키 접두는 prami:<env>:rl:<scope>: 이고 IP 키는 원문 IP 가 아니라 HMAC 값이다', async () => {
    const double = createUpstashDouble(TOKEN);
    const limiter = createUpstashRateLimiter('share', 30, { config: config(double) });
    const ip = '203.0.113.77';
    const key = rateLimitIpKey(new Headers({ 'x-vercel-forwarded-for': ip }), 'vercel');
    await limiter.hit(key);
    const [stored] = double.keys();
    expect(stored).toMatch(/^prami:preview:rl:share:ip:[A-Za-z0-9_-]{43}$/);
    expect(double.keys().join()).not.toContain(ip);
    // 같은 IP → 같은 키, 다른 IP → 다른 키, 신뢰 IP 없음 → 공용 키 그대로
    expect(rateLimitIpKey(new Headers({ 'x-vercel-forwarded-for': ip }), 'vercel')).toBe(key);
    expect(
      rateLimitIpKey(new Headers({ 'x-vercel-forwarded-for': '203.0.113.78' }), 'vercel'),
    ).not.toBe(key);
    expect(rateLimitIpKey(new Headers({ 'x-forwarded-for': ip }), 'none')).toBe(
      SHARED_RATE_LIMIT_KEY,
    );
  });

  it('토큰이 틀리면 백엔드 오류로 보고 memory 로 판정한다', async () => {
    const double = createUpstashDouble('other-token');
    const report = vi.fn();
    const limiter = createUpstashRateLimiter('chat', 1, { config: config(double), report });
    expect((await limiter.hit('k', 0)).allowed).toBe(true);
    expect(report).toHaveBeenCalledWith('chat', expect.objectContaining({ code: 'http_401' }));
  });
});

describe('Upstash 장애 → 요청 단위 memory fallback (AC-329)', () => {
  it.each([
    ['HTTP 500', { kind: 'status', status: 500 } as const, 'http_500'],
    ['300ms 지연(타임아웃 200ms)', { kind: 'delay', ms: 300 } as const, 'timeout'],
  ])('%s → 5xx 없이 memory 판정 + rate_limit.backend_error 경고', async (_name, fault, code) => {
    const double = createUpstashDouble(TOKEN);
    double.setFault(fault);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const limiter = createUpstashRateLimiter('chat', 2, { config: config(double) });
    const results = [
      await limiter.hit('k', 0),
      await limiter.hit('k', 1),
      await limiter.hit('k', 2),
    ];
    expect(results.map((decision) => decision.allowed)).toEqual([true, true, false]);
    const lines = warn.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(lines[0]).toMatchObject({
      level: 'warn',
      event: 'rate_limit.backend_error',
      scope: 'chat',
      code,
    });
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
    expect(JSON.stringify(lines)).not.toContain('"k"');
  });

  it('응답 형식이 깨지면 bad_response 로 fallback', async () => {
    const report = vi.fn();
    const brokenFetch: typeof fetch = async () => new Response('[{"result":"x"}]', { status: 200 });
    const limiter = createUpstashRateLimiter('chat', 5, {
      config: { url: 'https://x.example.com', token: TOKEN, envName: 'local', fetch: brokenFetch },
      report,
    });
    expect((await limiter.hit('k')).allowed).toBe(true);
    expect(report.mock.calls[0]![1]).toMatchObject({ code: 'bad_response' });
  });

  it.each([null, true, false, '3', 1.5, -1])(
    'ZCARD 가 정수가 아니면(%j) Number() 변환으로 허용하지 않고 bad_response (QA L-3)',
    async (zcard) => {
      const report = vi.fn();
      const payload = JSON.stringify([
        { result: 0 },
        { result: 1 },
        { result: zcard },
        { result: ['m', '0'] },
        { result: 1 },
      ]);
      const oddFetch: typeof fetch = async () => new Response(payload, { status: 200 });
      const limiter = createUpstashRateLimiter('chat', 5, {
        config: { url: 'https://x.example.com', token: TOKEN, envName: 'local', fetch: oddFetch },
        report,
      });
      await limiter.hit('k');
      expect(report).toHaveBeenCalledOnce();
      expect(report.mock.calls[0]![1]).toMatchObject({ code: 'bad_response' });
    },
  );

  it('1분 안에 50회 이상 실패하면 error 수준으로 올린다', () => {
    let now = 0;
    const reporter = createBackendErrorReporter(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < BACKEND_ERROR_ESCALATE_COUNT - 1; i += 1) {
      now += 100;
      reporter('chat', new UpstashError('timeout'));
    }
    expect(warn).toHaveBeenCalledTimes(BACKEND_ERROR_ESCALATE_COUNT - 1);
    expect(error).not.toHaveBeenCalled();
    reporter('chat', new UpstashError('timeout'));
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({
      level: 'error',
      event: 'rate_limit.backend_error',
      recentFailures: BACKEND_ERROR_ESCALATE_COUNT,
    });
    // 1분이 지나 창이 비면 다시 warn
    now += 60_001;
    reporter('chat', new Error('x'));
    expect(JSON.parse(String(warn.mock.calls.at(-1)![0]))).toMatchObject({
      code: 'unknown',
      recentFailures: 1,
    });
  });
});

describe('백엔드 상태·헬스 범위', () => {
  it('Upstash PING 왕복 성공·실패', async () => {
    const double = createUpstashDouble(TOKEN);
    expect(await upstashPing(config(double))).toBe(true);
    double.setFault({ kind: 'status', status: 503 });
    expect(await upstashPing(config(double))).toBe(false);
  });

  it('테스트 env 는 memory 백엔드 — 왕복 대상 없음', async () => {
    expect(await rateLimitBackendStatus()).toEqual({ backend: 'memory', reachable: true });
  });

  it('GET /api/health 는 IP 버킷, deep 은 제외', () => {
    expect(ipScopeFor('/api/health', 'GET')).toBe('health');
    expect(ipScopeFor('/api/health/deep', 'GET')).toBeNull();
    expect(ipScopeFor('/api/health', 'HEAD')).toBe('health');
    expect(ipScopeFor('/api/health', 'POST')).toBeNull();
  });
});
