import { env, type ProxyTrustMode } from '@/env';
import { trustedClientIp } from '@/server/audit/log';

/**
 * 속도 제한 단일 모듈 (§4.8 r6, AC-95). 키(사용자 id·IP)당 분당 `RATE_LIMIT_PER_MIN`(기본 30)회, 슬라이딩 윈도우, **프로세스 메모리**.
 *
 * | 대상 | 키 | 적용 위치 |
 * | --- | --- | --- |
 * | `POST /api/chat` | 사용자 | Route |
 * | `POST /api/imports/*` | 사용자 | Route |
 * | `GET /api/quotes/[id]/pdf` | IP | proxy |
 * | `/share/quotes/[token]` | IP | proxy (비로그인 페이지라 IP 만 가능) |
 * | `/api/auth/callback/*` | IP | proxy |
 * | 테스트 Credentials 로그인(Server Action) | 이메일 | authorize |
 *
 * 초과 → HTTP 429 + `Retry-After`(초) + `{ok:false, error:{code:'RATE_LIMITED'}}`. 감사 로그는 남기지 않고 구조화 로그만.
 * 한계: Vercel 서버리스는 인스턴스마다 메모리가 따로라 상한이 "인스턴스당 근사치" 가 되고, 콜드 스타트·재배포 때 초기화된다.
 * 공유 저장소(Upstash/Vercel KV) 전환은 후속 (docs/deploy/vercel.md "rate limit").
 */
export const RATE_LIMIT_DEFAULT = 30;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** 다음 허용까지 남은 ms (허용이면 0) */
  retryAfterMs: number;
};

export type RateLimiter = {
  readonly name: string;
  limit: () => number;
  hit: (key: string, now?: number) => RateLimitDecision;
  /** 테스트용: 상한 변경 */
  configure: (limit: number) => void;
  reset: () => void;
};

const MAX_BUCKETS = 10_000;

export function createRateLimiter(
  name: string,
  initialLimit: number = RATE_LIMIT_DEFAULT,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): RateLimiter {
  const buckets = new Map<string, number[]>();
  let limit = initialLimit;

  const prune = (floor: number) => {
    if (buckets.size <= MAX_BUCKETS) return;
    for (const [key, stamps] of buckets) {
      if (stamps.every((stamp) => stamp <= floor)) buckets.delete(key);
    }
  };

  return {
    name,
    limit: () => limit,
    hit(key, now = Date.now()) {
      const floor = now - windowMs;
      const recent = (buckets.get(key) ?? []).filter((stamp) => stamp > floor);
      if (recent.length >= limit) {
        buckets.set(key, recent);
        return { allowed: false, remaining: 0, retryAfterMs: recent[0]! + windowMs - now };
      }
      const next = [...recent, now];
      buckets.set(key, next);
      prune(floor);
      return { allowed: true, remaining: limit - next.length, retryAfterMs: 0 };
    },
    configure(next) {
      limit = next;
    },
    reset() {
      buckets.clear();
    },
  };
}

export function retryAfterSeconds(decision: RateLimitDecision): number {
  return Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
}

const LIMIT = env.RATE_LIMIT_PER_MIN;

export const rateLimiters = {
  chat: createRateLimiter('chat', LIMIT),
  imports: createRateLimiter('imports', LIMIT),
  pdf: createRateLimiter('pdf', LIMIT),
  share: createRateLimiter('share', LIMIT),
  authCallback: createRateLimiter('auth-callback', LIMIT),
  testLogin: createRateLimiter('test-login', LIMIT),
} as const;

export type RateLimitScope = keyof typeof rateLimiters;

/** proxy 가 IP 로 제한하는 경로 → 버킷 */
export function ipScopeFor(pathname: string, method: string): RateLimitScope | null {
  if (pathname.startsWith('/share/quotes/')) return 'share';
  if (method === 'GET' && /^\/api\/quotes\/[^/]+\/pdf$/.test(pathname)) return 'pdf';
  if (pathname.startsWith('/api/auth/callback/')) return 'authCallback';
  return null;
}

/**
 * 제한 키로 쓸 클라이언트 IP. 신뢰 프록시 모드면 audit 과 같은 규칙(trustedClientIp),
 * 아니면 Next 서버가 소켓 주소를 덧붙이는 x-forwarded-for 의 오른쪽 끝, 없으면 'unknown'.
 * (감사 로그와 달리 여기서는 위조돼도 "자기 버킷을 바꾸는" 효과뿐이라 오른쪽 끝 값을 쓴다)
 */
export function rateLimitIp(headers: Headers, mode: ProxyTrustMode): string {
  const trusted = trustedClientIp(headers, mode);
  if (trusted) return trusted;
  const forwarded = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.at(-1) ?? 'unknown';
}

/** 429 봉투 (Route·proxy 공용) */
export function rateLimitedResponse(decision: RateLimitDecision, message?: string): Response {
  const seconds = retryAfterSeconds(decision);
  return Response.json(
    {
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: message ?? `요청이 너무 잦습니다. ${seconds}초 후 다시 시도하세요`,
        details: { retryAfterSeconds: seconds },
      },
    },
    { status: 429, headers: { 'Retry-After': String(seconds), 'cache-control': 'no-store' } },
  );
}
