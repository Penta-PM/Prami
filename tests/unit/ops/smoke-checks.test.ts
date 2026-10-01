// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  bypassAllowed,
  runSmoke,
  SMOKE_CHECKS,
  type SmokeCheckId,
} from '@/server/ops/smoke-checks';
import { STATIC_SECURITY_HEADERS } from '@/server/security/headers';

/**
 * AC-361 preview 스모크 8항목 — 판정 함수 단위 검사. 정상 배포를 흉내 낸 가짜 사이트에서 8항목이 모두 통과하고,
 * 항목마다 그 항목만 깨뜨린 설정(고장 주입)에서는 **그 항목만** 실패한다. 실제 서버 대상 실행은 `pnpm smoke`(로컬 preview 모의).
 */
type Break =
  | 'health-503'
  | 'health-schema-behind'
  | 'test-mode-banner'
  | 'credentials-provider'
  | 'missing-hsts'
  | 'csp-no-nonce'
  | 'pricing-open'
  | 'chat-200'
  | 'server-action-runs'
  | 'share-200'
  | 'openrouter-redirect'
  | 'xff-bypass'
  | 'maintenance';

const NONCE = 'bm9uY2Utc21va2U=';
const BASE = 'https://preview.example.test';

function fakeSite(breaks: ReadonlySet<Break> = new Set()) {
  const seen: { url: string; headers: Headers }[] = [];
  let healthHits = 0;
  const security = (): Headers => {
    const headers = new Headers();
    for (const { key, value } of STATIC_SECURITY_HEADERS) {
      if (key === 'Strict-Transport-Security' && breaks.has('missing-hsts')) continue;
      headers.set(key, value);
    }
    headers.set(
      'content-security-policy',
      breaks.has('csp-no-nonce')
        ? "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        : `default-src 'self'; script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'; frame-ancestors 'none'`,
    );
    return headers;
  };
  const html = (body: string, status = 200) => {
    const headers = security();
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(`<html><script nonce="${NONCE}"></script>${body}</html>`, {
      status,
      headers,
    });
  };
  const redirect = (location: string) => new Response(null, { status: 307, headers: { location } });
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    seen.push({ url, headers: new Headers(init.headers) });
    // src/proxy.ts 점검 모드: /login·/api/auth/*·/api/health 만 열림, 나머지는 503 + Retry-After (API 는 봉투)
    const open = ['/login', '/api/auth/', '/api/health'].some((prefix) =>
      pathname.startsWith(prefix),
    );
    if (breaks.has('maintenance') && !open) {
      const headers = { 'retry-after': '300', 'cache-control': 'no-store' };
      return pathname.startsWith('/api/')
        ? Response.json(
            { ok: false, error: { code: 'MAINTENANCE', message: '점검' } },
            { status: 503, headers },
          )
        : new Response('<p>점검</p>', { status: 503, headers });
    }
    if (pathname === '/api/health') {
      healthHits += 1;
      // 위조 X-Forwarded-For 를 키로 쓰는 고장: 요청마다 새 버킷 → 429 가 오지 않는다
      const limited = !breaks.has('xff-bypass') && healthHits > 30;
      if (limited) return new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
      const behind = breaks.has('health-schema-behind');
      const down = breaks.has('health-503');
      return Response.json(
        {
          ok: !behind && !down,
          release: 'sha-1',
          db: down ? 'error' : 'ok',
          schema: behind ? 'behind' : down ? 'unknown' : 'ok',
          data: down ? 'unknown' : 'ok',
        },
        { status: behind || down ? 503 : 200, headers: { 'cache-control': 'no-store' } },
      );
    }
    if (pathname === '/login') {
      const banner = breaks.has('test-mode-banner') ? '<div role="status">TEST MODE</div>' : '';
      return html(`${banner}<button>Google 계정으로 로그인</button>`);
    }
    if (pathname === '/api/auth/providers') {
      return Response.json(
        breaks.has('credentials-provider')
          ? { google: {}, 'test-credentials': {} }
          : { google: {} },
      );
    }
    if (pathname === '/pricing' && method === 'POST') {
      return breaks.has('server-action-runs')
        ? new Response('0:{"ok":true}', { status: 200 })
        : redirect(`${BASE}/login?callbackUrl=%2Fpricing`);
    }
    if (pathname === '/pricing') {
      return breaks.has('pricing-open')
        ? html('가격 조회')
        : redirect('/login?callbackUrl=%2Fpricing');
    }
    if (pathname === '/api/chat') {
      return breaks.has('chat-200')
        ? Response.json({ ok: true, data: {} })
        : Response.json(
            { ok: false, error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' } },
            { status: 401 },
          );
    }
    if (pathname.startsWith('/share/quotes/')) {
      return breaks.has('share-200') ? html('견적') : html('없음', 404);
    }
    if (pathname === '/api/settings/oauth/openrouter/start') {
      return breaks.has('openrouter-redirect')
        ? redirect('https://openrouter.ai/auth?callback_url=x')
        : Response.json({ ok: false }, { status: 401 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, seen };
}

const failed = async (breaks: Break[]) => {
  const { fetchImpl } = fakeSite(new Set(breaks));
  const results = await runSmoke({ baseUrl: BASE, fetch: fetchImpl });
  return results.filter((result) => !result.ok).map((result) => result.id);
};

describe('AC-361 스모크 판정', () => {
  it('정상 배포: 8항목 통과, 번호 순서대로 실행하고 rate limit 이 마지막', async () => {
    const { fetchImpl } = fakeSite();
    const results = await runSmoke({ baseUrl: `${BASE}/`, fetch: fetchImpl });
    expect(results.map((result) => [result.id, result.ok])).toEqual(
      SMOKE_CHECKS.map((check) => [check.id, true]),
    );
    expect(results.at(-1)?.id).toBe('rate-limit');
    expect(results).toHaveLength(8);
  });

  it.each<[Break, SmokeCheckId]>([
    ['health-503', 'health'],
    ['health-schema-behind', 'health'],
    ['test-mode-banner', 'login'],
    ['credentials-provider', 'login'],
    ['missing-hsts', 'headers'],
    ['csp-no-nonce', 'headers'],
    ['pricing-open', 'auth-gate'],
    ['chat-200', 'auth-gate'],
    ['server-action-runs', 'server-action'],
    ['share-200', 'share-404'],
    ['openrouter-redirect', 'openrouter-start'],
    ['xff-bypass', 'rate-limit'],
  ])('고장 주입 %s → %s 만 실패', async (fault, expected) => {
    expect(await failed([fault])).toEqual([expected]);
  });

  it('배포 SHA 기대값이 다르면 health 실패, 같으면 통과', async () => {
    const run = async (expectRelease: string) => {
      const { fetchImpl } = fakeSite();
      const [health] = await runSmoke({ baseUrl: BASE, fetch: fetchImpl, expectRelease });
      return health!;
    };
    expect((await run('sha-1')).ok).toBe(true);
    expect((await run('sha-2')).problems).toContain('release 가 배포 커밋과 다름');
  });

  const PATTERN = 'prami-*-team.vercel.app';

  it('배포 보호 우회 시크릿은 https + 프로젝트 호스트 패턴 대상에만 헤더로 싣고, 결과(problems)에는 남기지 않는다', async () => {
    const vercel = 'https://prami-abc123-team.vercel.app';
    const { fetchImpl, seen } = fakeSite(new Set(['missing-hsts']));
    const results = await runSmoke({
      baseUrl: vercel,
      fetch: fetchImpl,
      bypassSecret: 'bypass-xyz',
      bypassHostPattern: PATTERN,
    });
    expect(
      seen.every((call) => call.headers.get('x-vercel-protection-bypass') === 'bypass-xyz'),
    ).toBe(true);
    expect(seen.every((call) => !call.url.includes('bypass-xyz'))).toBe(true);
    expect(JSON.stringify(results)).not.toContain('bypass-xyz');
  });

  it.each([
    'https://preview.example.test',
    'http://prami-abc-team.vercel.app',
    'https://vercel.app.evil.example',
    // PR #26 L-S1: 아무 *.vercel.app 이 아니라 이 프로젝트·팀 패턴만
    'https://evil.com.vercel.app',
    'https://evil-team.vercel.app',
    'https://prami-team.vercel.app',
    'https://prami-a.b-team.vercel.app',
    'https://prami-abc-team.vercel.app:8443',
    'https://prami-abc-team.vercel.app.evil.example',
    'not a url',
  ])('보안 리뷰 M-2·L-S1: %s 에는 우회 시크릿을 보내지 않는다', async (baseUrl) => {
    expect(bypassAllowed(baseUrl, PATTERN)).toBe(false);
    const { fetchImpl, seen } = fakeSite();
    if (baseUrl !== 'not a url') {
      await runSmoke({
        baseUrl,
        fetch: fetchImpl,
        bypassSecret: 'bypass-xyz',
        bypassHostPattern: PATTERN,
        rateLimitAttempts: 1,
      });
      expect(seen.some((call) => call.headers.has('x-vercel-protection-bypass'))).toBe(false);
    }
  });

  it.each([
    undefined,
    '',
    '*.vercel.app',
    'prami-*',
    'prami-*-team.example.com',
    'a-*-*-b.vercel.app',
  ])(
    'L-S1: 호스트 패턴이 없거나 모양이 틀리면(%s) 프로젝트 호스트에도 보내지 않는다',
    (pattern) => {
      expect(bypassAllowed('https://prami-abc123-team.vercel.app', pattern)).toBe(false);
    },
  );

  it('L-S1: 패턴의 * 는 배포 고유 해시 한 칸만 — 하이픈이 든 별칭은 거부 (대소문자 무시)', () => {
    expect(bypassAllowed('https://prami-git-feat-x-team.vercel.app', PATTERN)).toBe(false);
    expect(bypassAllowed('https://prami-x-y-team.vercel.app', PATTERN)).toBe(false);
    expect(bypassAllowed('https://PRAMI-ABC123-TEAM.vercel.app/', PATTERN)).toBe(true);
  });

  describe('D-1 점검 모드 스모크 (maintenance: true)', () => {
    it('503 이어도 Retry-After 가 없거나 API 봉투 code 가 MAINTENANCE 가 아니면 실패 (일반 장애와 구분)', async () => {
      const outage = async (url: string) => {
        const { pathname } = new URL(url);
        if (pathname === '/api/chat') {
          return Response.json(
            { ok: false, error: { code: 'INTERNAL' } },
            { status: 503, headers: { 'retry-after': '1' } },
          );
        }
        return new Response('down', { status: 503 });
      };
      const results = await runSmoke({
        baseUrl: BASE,
        fetch: outage,
        maintenance: true,
        rateLimitAttempts: 1,
      });
      const authGate = results.find((result) => result.id === 'auth-gate')!;
      expect(authGate.problems).toEqual([
        'GET /pricing status 503 (점검 503 기대)',
        'POST /api/chat code INTERNAL',
      ]);
    });

    const maintenanceFailed = async (breaks: Break[]) => {
      const { fetchImpl } = fakeSite(new Set(breaks));
      const results = await runSmoke({ baseUrl: BASE, fetch: fetchImpl, maintenance: true });
      return results.filter((result) => !result.ok).map((result) => result.id);
    };

    it('점검 중 배포: ④~⑦이 점검 503 이면 8항목 통과 (①②③⑧ 은 열린 경로라 그대로)', async () => {
      expect(await maintenanceFailed(['maintenance'])).toEqual([]);
    });

    it('점검 모드를 기대했는데 쓰기 경로가 열려 있으면(점검 해제된 배포) ④~⑦ 실패', async () => {
      expect(await maintenanceFailed([])).toEqual([
        'auth-gate',
        'server-action',
        'share-404',
        'openrouter-start',
      ]);
    });

    it('일반 스모크가 점검 중 배포를 만나면 ④~⑦ 실패 — 점검 모드 배포는 SMOKE_MAINTENANCE=true 로만 통과', async () => {
      expect(await failed(['maintenance'])).toEqual([
        'auth-gate',
        'server-action',
        'share-404',
        'openrouter-start',
      ]);
    });

    it('점검 중에도 헬스·로그인 고장은 그대로 잡는다', async () => {
      expect(await maintenanceFailed(['maintenance', 'health-503', 'test-mode-banner'])).toEqual([
        'health',
        'login',
      ]);
    });
  });

  it('요청 자체가 실패하면(연결 거부) 오류 이름만 남기고 모든 항목 실패', async () => {
    const refused = async () => {
      throw Object.assign(new TypeError('fetch failed http://secret-host'), {});
    };
    const results = await runSmoke({ baseUrl: BASE, fetch: refused });
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0]!.problems).toEqual(['요청 실패: TypeError']);
  });

  it('헬스 응답이 JSON 이 아니면 실패', async () => {
    const fetchImpl = async () => new Response('<html>', { status: 200 });
    const [health] = await runSmoke({ baseUrl: BASE, fetch: fetchImpl, rateLimitAttempts: 1 });
    expect(health!.problems).toContain('응답이 JSON 이 아님');
  });
});
