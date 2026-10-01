import { createHmac } from 'node:crypto';

import { env, type ProxyTrustMode } from '@/env';
import { trustedClientIp } from '@/server/audit/log';

import {
  createBackendErrorReporter,
  upstashKey,
  upstashPing,
  upstashSlidingWindow,
  type UpstashConfig,
} from './rate-limit-upstash';

/**
 * 속도 제한 단일 모듈 (§4.8 r6, AC-95). 키(사용자 id·IP)당 분당 `RATE_LIMIT_PER_MIN`(기본 30)회, 슬라이딩 윈도우.
 * 저장소는 `RATE_LIMIT_BACKEND`: memory(인스턴스 메모리, 로컬 기본) | upstash(인스턴스 간 공유, 운영 기본 — PRAMI-003 §4.3.7).
 *
 * | 대상 | 키 | 적용 위치 |
 * | --- | --- | --- |
 * | `POST /api/chat` | 사용자 | Route |
 * | `POST /api/imports/*` | 사용자 | Route |
 * | `GET /api/quotes/[id]/pdf` | IP | proxy |
 * | `/share/quotes/[token]` | IP | proxy (비로그인 페이지라 IP 만 가능) |
 * | `/api/auth/callback/*` | IP | proxy |
 * | `GET /api/health` | IP | proxy (PRAMI-003 §4.3.10) |
 * | 테스트 Credentials 로그인(Server Action) | 이메일 | authorize |
 *
 * 초과 → HTTP 429 + `Retry-After`(초) + `{ok:false, error:{code:'RATE_LIMITED'}}`. 감사 로그는 남기지 않고 구조화 로그만.
 * memory 의 한계: Vercel 서버리스는 인스턴스마다 메모리가 따로라 상한이 "인스턴스당 근사치" 가 된다 — 운영은 upstash
 * (memory 는 RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION 위험 수용 시만, env 기동 검사 ⓘ). docs/deploy/vercel.md §5.
 * IP 키는 신뢰 프록시 모드에서만 실제 IP 이고, 기본(none)에서는 경로 단위 공용 버킷이다 (rateLimitIp).
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
  /** 판정 저장소: 인스턴스 메모리 | Upstash(인스턴스 간 공유) */
  readonly backend: 'memory' | 'upstash';
  limit: () => number;
  hit: (key: string, now?: number) => Promise<RateLimitDecision>;
  /** 테스트용: 상한 변경 */
  configure: (limit: number) => void;
  reset: () => void;
};

const MAX_BUCKETS = 10_000;

type MemoryCore = {
  hit: (key: string, limit: number, now: number) => RateLimitDecision;
  reset: () => void;
};

function createMemoryCore(windowMs: number): MemoryCore {
  const buckets = new Map<string, number[]>();

  const prune = (floor: number) => {
    if (buckets.size <= MAX_BUCKETS) return;
    for (const [key, stamps] of buckets) {
      if (stamps.every((stamp) => stamp <= floor)) buckets.delete(key);
    }
  };

  return {
    hit(key, limit, now) {
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
    reset: () => buckets.clear(),
  };
}

/** 인스턴스 메모리 limiter (로컬 기본·Upstash 장애 시 fallback) */
export function createRateLimiter(
  name: string,
  initialLimit: number = RATE_LIMIT_DEFAULT,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): RateLimiter {
  const core = createMemoryCore(windowMs);
  let limit = initialLimit;
  return {
    name,
    backend: 'memory',
    limit: () => limit,
    hit: async (key, now = Date.now()) => core.hit(key, limit, now),
    configure(next) {
      limit = next;
    },
    reset: () => core.reset(),
  };
}

export type UpstashLimiterOptions = {
  config: UpstashConfig;
  windowMs?: number;
  /** 백엔드 오류 기록 (기본: 공유 reporter — 1분 50회 이상이면 error) */
  report?: (scope: string, error: unknown) => void;
};

const reportBackendError = createBackendErrorReporter();

/**
 * Upstash 공유 limiter (PRAMI-003 §4.3.7). 같은 키를 쓰는 인스턴스끼리 한도를 합산한다.
 * 백엔드 오류·타임아웃이면 그 요청만 인스턴스 메모리로 판정한다(가용성 우선, 5xx 없음).
 */
export function createUpstashRateLimiter(
  name: string,
  initialLimit: number,
  options: UpstashLimiterOptions,
): RateLimiter {
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const fallback = createMemoryCore(windowMs);
  const report = options.report ?? reportBackendError;
  let limit = initialLimit;
  return {
    name,
    backend: 'upstash',
    limit: () => limit,
    async hit(key, now = Date.now()) {
      try {
        const redisKey = upstashKey(options.config.envName, name, key);
        return await upstashSlidingWindow(options.config, redisKey, limit, windowMs, now);
      } catch (error) {
        report(name, error);
        return fallback.hit(key, limit, now);
      }
    },
    configure(next) {
      limit = next;
    },
    reset: () => fallback.reset(),
  };
}

export function retryAfterSeconds(decision: RateLimitDecision): number {
  return Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
}

const LIMIT = env.RATE_LIMIT_PER_MIN;

/** env 에서 Upstash 설정 (backend=upstash 이면 URL·토큰은 env 스키마가 보장) */
function upstashConfigFromEnv(): UpstashConfig | null {
  if (env.RATE_LIMIT_BACKEND !== 'upstash') return null;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return {
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    envName: env.VERCEL_ENV ?? 'local',
  };
}

const UPSTASH = upstashConfigFromEnv();

const limiter = (name: string, limit: number): RateLimiter =>
  UPSTASH
    ? createUpstashRateLimiter(name, limit, { config: UPSTASH })
    : createRateLimiter(name, limit);

export const rateLimiters = {
  chat: limiter('chat', LIMIT),
  imports: limiter('imports', LIMIT),
  pdf: limiter('pdf', LIMIT),
  share: limiter('share', LIMIT),
  authCallback: limiter('auth-callback', LIMIT),
  health: limiter('health', LIMIT),
  testLogin: limiter('test-login', LIMIT),
  /** PRAMI-002 §4.6.3: 키 검증 사용자당 분당 LLM_VERIFY_PER_MIN (키 오라클 방지) */
  llmVerify: limiter('llm-verify', env.LLM_VERIFY_PER_MIN),
} as const;

/** 헬스 deep: 현재 백엔드와 왕복 가능 여부 (memory 는 왕복 대상이 없어 true) */
export async function rateLimitBackendStatus(): Promise<{ backend: string; reachable: boolean }> {
  if (!UPSTASH) return { backend: 'memory', reachable: true };
  return { backend: 'upstash', reachable: await upstashPing(UPSTASH) };
}

export type RateLimitScope = keyof typeof rateLimiters;

/** proxy 가 IP 로 제한하는 경로 → 버킷 */
export function ipScopeFor(pathname: string, method: string): RateLimitScope | null {
  if (pathname.startsWith('/share/quotes/')) return 'share';
  if (method === 'GET' && /^\/api\/quotes\/[^/]+\/pdf$/.test(pathname)) return 'pdf';
  if (pathname.startsWith('/api/auth/callback/')) return 'authCallback';
  if ((method === 'GET' || method === 'HEAD') && pathname === '/api/health') return 'health';
  return null;
}

/** 신뢰할 IP 가 없을 때 쓰는 경로 단위 공용 키 */
export const SHARED_RATE_LIMIT_KEY = 'shared:untrusted-client';

/**
 * 제한 키 (PR-11a QA M-2). 감사 IP 와 **같은 신뢰 헤더 정책**(`server/audit/log.ts` trustedClientIp)만 쓴다.
 * - `vercel`/`generic`: 신뢰 프록시가 준 클라이언트 IP
 * - `none`(기본) 또는 신뢰 헤더 없음: 클라이언트가 보낸 X-Forwarded-For 는 **무시**하고 경로 단위 공용 키 —
 *   헤더를 바꿔 가며 한도를 우회할 수 없다. 대신 그 경로의 전체 요청이 한 버킷을 나눠 쓴다(운영은 vercel 모드 전제).
 *   Next 16 proxy 에서는 소켓 주소를 얻을 수 없다(NextRequest.ip 제거) — `next start` 도 XFF 에 소켓 주소를 덧붙이지 않는다.
 */
export function rateLimitIp(headers: Headers, mode: ProxyTrustMode): string {
  return trustedClientIp(headers, mode) ?? SHARED_RATE_LIMIT_KEY;
}

/**
 * 저장소에 넣는 IP 키 (PRAMI-003 §4.3.7) — 원문 IP 를 Redis 에 남기지 않도록 `AUTH_SECRET` 파생 HMAC-SHA256.
 * 신뢰 IP 가 없을 때의 공용 키는 그대로 둔다.
 */
export function rateLimitIpKey(headers: Headers, mode: ProxyTrustMode): string {
  const ip = rateLimitIp(headers, mode);
  if (ip === SHARED_RATE_LIMIT_KEY) return ip;
  const secret = `prami-rate-limit:${env.AUTH_SECRET ?? 'local'}`;
  return `ip:${createHmac('sha256', secret).update(ip).digest('base64url')}`;
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
