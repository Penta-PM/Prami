import { STATIC_SECURITY_HEADERS } from '@/server/security/headers';

/**
 * preview·프로덕션 스모크 8항목 (PRAMI-003 §4.3.10, AC-361) — 비인증 HTTP 요청만 쓴다(테스트 모드·실 Google 없음).
 * Playwright 스모크(`tests/smoke`)·배포 워크플로·`release:check headers` 가 같은 판정 함수를 쓴다.
 * 결과 `detail` 에는 상태 코드·헤더 이름·필드 이름만 싣는다(응답 본문·쿠키·시크릿 없음).
 */
export type SmokeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type SmokeOptions = {
  baseUrl: string;
  fetch?: SmokeFetch;
  /**
   * Vercel 배포 보호 우회(`x-vercel-protection-bypass`). 대상이 https 이고 `bypassHostPattern` 에 맞는 이 프로젝트의
   * Vercel 배포 호스트일 때만 싣는다 — 다른 호스트로 시크릿이 새지 않게 (보안 리뷰 M-2, PR #26 L-S1)
   */
  bypassSecret?: string;
  /** 우회 시크릿을 보낼 호스트 패턴 — `<프로젝트>-*-<팀 슬러그>.vercel.app` (`*` 1개). 없으면 시크릿을 보내지 않는다 */
  bypassHostPattern?: string;
  /**
   * 점검 모드(MAINTENANCE_MODE=true) 배포 스모크 (PR #26 D-1). ④~⑦은 리다이렉트·401·404 대신 **점검 503** 을 기대한다 —
   * 쓰기 차단이 실제로 걸려 있는지 확인한다. ①②③⑧ 은 점검 중에도 같다(`/login`·`/api/auth/*`·`/api/health` 는 열림)
   */
  maintenance?: boolean;
  /** 배포 직후 스모크: 헬스 `release` 가 이 값(커밋 SHA)이어야 한다 */
  expectRelease?: string;
  /** rate limit 확인 요청 수 상한 (헬스 IP 한도 30/분 → 31회 이내 429) */
  rateLimitAttempts?: number;
};

export type SmokeCheckId =
  | 'health'
  | 'login'
  | 'headers'
  | 'auth-gate'
  | 'server-action'
  | 'share-404'
  | 'openrouter-start'
  | 'rate-limit';

export type SmokeResult = { id: SmokeCheckId; title: string; ok: boolean; problems: string[] };

type Ctx = Required<Pick<SmokeOptions, 'baseUrl' | 'rateLimitAttempts'>> & {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  expectRelease?: string;
  maintenance: boolean;
};

type SmokeCheck = { id: SmokeCheckId; title: string; run: (ctx: Ctx) => Promise<string[]> };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const GOOGLE_BUTTON_LABEL = 'Google 계정으로 로그인';
const TEST_FORM_LABEL = '테스트 계정 로그인';
/** 존재할 수 없는 공유 토큰(64 hex) — 매 실행 다르게 만들어 캐시를 피한다 */
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 64);

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function redirectsToLogin(response: Response, baseUrl: string): boolean {
  if (!REDIRECT_STATUSES.has(response.status)) return false;
  const location = response.headers.get('location');
  if (!location) return false;
  return new URL(location, baseUrl).pathname === '/login';
}

/** 점검 모드 503 (src/proxy.ts maintenanceResponse) 판정 — Retry-After 가 있고, API 는 봉투 code MAINTENANCE */
async function maintenanceProblemsOf(response: Response, label: string): Promise<string[]> {
  if (response.status !== 503 || !response.headers.get('retry-after')) {
    await response.body?.cancel();
    return [`${label} status ${response.status} (점검 503 기대)`];
  }
  if (!label.includes('/api/')) {
    await response.body?.cancel();
    return [];
  }
  const body = (await readJson(response)) as { error?: { code?: unknown } } | null;
  return body?.error?.code === 'MAINTENANCE' ? [] : [`${label} code ${String(body?.error?.code)}`];
}

async function maintenanceProblems(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<string[]> {
  const label = `${init.method ?? 'GET'} ${path.startsWith('/share/') ? '/share/quotes/…' : path}`;
  return maintenanceProblemsOf(await ctx.request(path, init), label);
}

const CHAT_PROBE: RequestInit = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'smoke' }] }),
};
const SERVER_ACTION_PROBE: RequestInit = {
  method: 'POST',
  headers: { 'next-action': '0'.repeat(42), 'content-type': 'text/plain;charset=UTF-8' },
  body: '[]',
};

/** ① `/api/health` 200 · schema ok (+ db·data ok, no-store, 배포 SHA) */
async function checkHealth(ctx: Ctx): Promise<string[]> {
  const response = await ctx.request('/api/health');
  const problems: string[] = [];
  if (response.status !== 200) problems.push(`status ${response.status} (200 기대)`);
  if (!(response.headers.get('cache-control') ?? '').includes('no-store')) {
    problems.push('cache-control no-store 없음');
  }
  const body = (await readJson(response)) as Record<string, unknown> | null;
  if (!body) return [...problems, '응답이 JSON 이 아님'];
  for (const [field, expected] of [
    ['ok', true],
    ['db', 'ok'],
    ['schema', 'ok'],
    ['data', 'ok'],
  ] as const) {
    if (body[field] !== expected) problems.push(`${field}=${String(body[field])}`);
  }
  if (ctx.expectRelease && body.release !== ctx.expectRelease) {
    problems.push('release 가 배포 커밋과 다름');
  }
  return problems;
}

/** ② `/login` 에 Google 버튼만 — 테스트 폼·TEST MODE 배너·Credentials 공급자 없음 (AC-94 ④) */
async function checkLogin(ctx: Ctx): Promise<string[]> {
  const response = await ctx.request('/login');
  const html = await response.text();
  const problems: string[] = [];
  if (response.status !== 200) problems.push(`/login status ${response.status}`);
  if (!html.includes(GOOGLE_BUTTON_LABEL)) problems.push('Google 로그인 버튼 없음');
  if (html.includes('TEST MODE')) problems.push('TEST MODE 배너 있음');
  if (html.includes(TEST_FORM_LABEL)) problems.push('테스트 계정 로그인 폼 있음');
  const providers = (await readJson(await ctx.request('/api/auth/providers'))) as Record<
    string,
    unknown
  > | null;
  const names = providers ? Object.keys(providers).sort() : [];
  if (names.join(',') !== 'google') problems.push(`로그인 공급자 [${names.join(',')}]`);
  return problems;
}

/** ③ 보안 헤더 6종 + CSP nonce (AC-91) — 문서의 인라인 스크립트가 같은 nonce 를 쓴다 */
export async function checkSecurityHeaders(
  request: (path: string) => Promise<Response>,
): Promise<string[]> {
  const response = await request('/login');
  const problems: string[] = [];
  for (const { key, value } of STATIC_SECURITY_HEADERS) {
    const actual = response.headers.get(key);
    if (actual !== value) problems.push(`${key} ${actual === null ? '없음' : '값 다름'}`);
  }
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = /script-src 'self' 'nonce-([^']+)' 'strict-dynamic'/.exec(csp)?.[1];
  if (!nonce) problems.push('CSP script-src nonce 없음');
  if (!csp.includes("frame-ancestors 'none'")) problems.push("CSP frame-ancestors 'none' 없음");
  if (nonce && !(await response.text()).includes(`nonce="${nonce}"`)) {
    problems.push('문서 스크립트에 CSP nonce 없음');
  }
  return problems;
}

/** ④ 비인증 `/pricing` → `/login` 리다이렉트, 비인증 `POST /api/chat` → 401 봉투 */
async function checkAuthGate(ctx: Ctx): Promise<string[]> {
  if (ctx.maintenance) {
    return [
      ...(await maintenanceProblems(ctx, '/pricing')),
      ...(await maintenanceProblems(ctx, '/api/chat', CHAT_PROBE)),
    ];
  }
  const problems: string[] = [];
  const page = await ctx.request('/pricing');
  if (!redirectsToLogin(page, ctx.baseUrl)) problems.push(`/pricing status ${page.status}`);
  const chat = await ctx.request('/api/chat', CHAT_PROBE);
  const body = (await readJson(chat)) as { ok?: unknown; error?: { code?: unknown } } | null;
  if (chat.status !== 401 || body?.ok !== false || body.error?.code !== 'UNAUTHENTICATED') {
    problems.push(`POST /api/chat status ${chat.status} code ${String(body?.error?.code)}`);
  }
  return problems;
}

/** ⑤ 비인증 Server Action 직접 호출 → proxy 가 /login 으로 돌려보낸다(액션 미실행) */
async function checkServerAction(ctx: Ctx): Promise<string[]> {
  if (ctx.maintenance) return maintenanceProblems(ctx, '/pricing', SERVER_ACTION_PROBE);
  const response = await ctx.request('/pricing', SERVER_ACTION_PROBE);
  return redirectsToLogin(response, ctx.baseUrl) || response.status === 401
    ? []
    : [`Server Action status ${response.status}`];
}

/** ⑥ 없는 공유 토큰 → 404 */
async function checkShare404(ctx: Ctx): Promise<string[]> {
  if (ctx.maintenance) return maintenanceProblems(ctx, `/share/quotes/${randomToken()}`);
  const response = await ctx.request(`/share/quotes/${randomToken()}`);
  return response.status === 404 ? [] : [`status ${response.status} (404 기대)`];
}

/**
 * ⑦ OpenRouter OAuth 시작 — 비인증은 proxy 가 401 로 막고, 로그인했더라도 플래그 off 면 404 다.
 * 어느 쪽이든 벤더(openrouter.ai)로 가는 리다이렉트가 나오면 실패(점검 모드에서는 점검 503 기대). 플래그 자체의 확인은 인증 E2E(`chat-llm.spec`)와 C-3 env 비교.
 */
async function checkOpenRouterStart(ctx: Ctx): Promise<string[]> {
  const response = await ctx.request('/api/settings/oauth/openrouter/start');
  const location = response.headers.get('location') ?? '';
  if (location.includes('openrouter.ai')) return ['벤더 인가 페이지로 리다이렉트됨'];
  if (ctx.maintenance) {
    return maintenanceProblemsOf(response, 'GET /api/settings/oauth/openrouter/start');
  }
  return response.status === 401 || response.status === 404
    ? []
    : [`status ${response.status} (401/404 기대)`];
}

/** ⑧ 위조 X-Forwarded-For 를 매번 바꿔도 한도가 풀리지 않는다 — 상한 횟수 안에 429 + Retry-After */
async function checkRateLimit(ctx: Ctx): Promise<string[]> {
  for (let attempt = 1; attempt <= ctx.rateLimitAttempts; attempt += 1) {
    const response = await ctx.request('/api/health', {
      headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
    });
    await response.body?.cancel();
    if (response.status === 429) {
      return response.headers.get('retry-after') ? [] : ['429 에 Retry-After 없음'];
    }
  }
  return [`${ctx.rateLimitAttempts}회 동안 429 없음 (X-Forwarded-For 로 한도 우회)`];
}

/** 실행 순서 = 스펙 번호 순. rate limit 은 헬스 버킷을 소진하므로 항상 마지막 */
export const SMOKE_CHECKS: readonly SmokeCheck[] = [
  { id: 'health', title: '① /api/health 200 · schema ok', run: checkHealth },
  { id: 'login', title: '② /login Google 버튼만 (테스트 모드 없음)', run: checkLogin },
  {
    id: 'headers',
    title: '③ 보안 헤더 6종 + CSP nonce',
    run: (ctx) => checkSecurityHeaders((path) => ctx.request(path)),
  },
  {
    id: 'auth-gate',
    title: '④ 비인증 /pricing → /login, POST /api/chat → 401',
    run: checkAuthGate,
  },
  { id: 'server-action', title: '⑤ 비인증 Server Action 직접 호출 차단', run: checkServerAction },
  { id: 'share-404', title: '⑥ 없는 공유 토큰 404', run: checkShare404 },
  { id: 'openrouter-start', title: '⑦ OpenRouter OAuth 시작 차단', run: checkOpenRouterStart },
  {
    id: 'rate-limit',
    title: '⑧ 위조 X-Forwarded-For 로 rate limit 우회 불가',
    run: checkRateLimit,
  },
];

/** `<프로젝트>-*-<팀 슬러그>.vercel.app` — 앞·뒤 고정부가 있고 `*` 는 정확히 1개 */
const BYPASS_PATTERN_SHAPE = /^([a-z0-9][a-z0-9-]*-)\*(-[a-z0-9-]*[a-z0-9]\.vercel\.app)$/;

/**
 * 우회 시크릿을 보내도 되는 대상인지 — https + 이 프로젝트의 Vercel 배포 호스트 패턴(`bypassHostPattern`).
 * 패턴이 없거나 모양이 틀리면 보내지 않는다(아무 `*.vercel.app` 로 새지 않게 — PR #26 L-S1)
 */
export function bypassAllowed(baseUrl: string, hostPattern: string | undefined): boolean {
  const shape = BYPASS_PATTERN_SHAPE.exec((hostPattern ?? '').trim().toLowerCase());
  if (!shape) return false;
  const [, prefix, suffix] = shape as unknown as [string, string, string];
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const middle = host.slice(prefix.length, host.length - suffix.length);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      host.startsWith(prefix) &&
      host.endsWith(suffix) &&
      host.length > prefix.length + suffix.length &&
      // 배포 고유 해시 한 칸만(하이픈 없음) — git 브랜치 별칭·다른 팀의 `<프로젝트>-x-y-<팀>` 류 이름을 받지 않는다
      /^[a-z0-9]+$/.test(middle)
    );
  } catch {
    return false;
  }
}

export function smokeContext(options: SmokeOptions): Ctx {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const bypass =
    options.bypassSecret && bypassAllowed(baseUrl, options.bypassHostPattern)
      ? options.bypassSecret
      : undefined;
  return {
    baseUrl,
    maintenance: options.maintenance ?? false,
    rateLimitAttempts: options.rateLimitAttempts ?? 31,
    ...(options.expectRelease ? { expectRelease: options.expectRelease } : {}),
    request: (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (bypass) headers.set('x-vercel-protection-bypass', bypass);
      return doFetch(`${baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
    },
  };
}

export async function runSmokeCheck(check: SmokeCheck, ctx: Ctx): Promise<SmokeResult> {
  let problems: string[];
  try {
    problems = await check.run(ctx);
  } catch (error) {
    problems = [`요청 실패: ${error instanceof Error ? error.name : 'unknown'}`];
  }
  return { id: check.id, title: check.title, ok: problems.length === 0, problems };
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult[]> {
  const ctx = smokeContext(options);
  const results: SmokeResult[] = [];
  for (const check of SMOKE_CHECKS) results.push(await runSmokeCheck(check, ctx));
  return results;
}
