import { randomUUID } from 'node:crypto';

import { logger } from '@/server/log';

/**
 * Upstash Redis REST 백엔드 (PRAMI-003 §4.3.7). 인스턴스 간 공유 슬라이딩 윈도우 — 정렬 집합(타임스탬프) 하나를 키마다 쓴다.
 * 한 번의 `POST {url}/multi-exec`(트랜잭션)로 오래된 항목 삭제 → 이번 요청 추가 → 개수·최古 시각 조회 → 만료 갱신을 한다.
 * 초과면 방금 넣은 항목을 지운다(거부된 요청은 세지 않음 — memory 백엔드와 같은 의미).
 *
 * `@upstash/ratelimit` 대신 REST 를 직접 호출한다: 라이브러리는 Lua(EVALSHA) 스크립트로 판정해 "Upstash REST 호환 테스트 더블"
 * (AC-328)로 검증할 수 없고, 필요한 명령이 5개뿐이라 의존성을 늘리지 않는다. Edge/Node 모두 fetch 만 쓴다.
 *
 * 장애(오류·타임아웃 200ms)면 그 요청만 호출자가 준 fallback(인메모리)으로 판정하고 `rate_limit.backend_error` 경고를 남긴다.
 * 1분 안에 50회 이상 실패하면 error 수준으로 올린다. 키·토큰·IP 는 로그에 남기지 않는다(scope·code 만).
 */
export type UpstashDecision = { allowed: boolean; remaining: number; retryAfterMs: number };

export type UpstashConfig = {
  url: string;
  token: string;
  /** 키 공간 `prami:<env>:rl:` 의 env (VERCEL_ENV 또는 local) */
  envName: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export const UPSTASH_TIMEOUT_MS = 200;
export const BACKEND_ERROR_ESCALATE_COUNT = 50;
const ERROR_WINDOW_MS = 60_000;

type RestResult = { result?: unknown; error?: string };

export class UpstashError extends Error {
  constructor(readonly code: string) {
    super(`upstash ${code}`);
    this.name = 'UpstashError';
  }
}

export function upstashKey(envName: string, scope: string, key: string): string {
  return `prami:${envName}:rl:${scope}:${key}`;
}

async function restCall(config: UpstashConfig, path: string, body: unknown): Promise<unknown> {
  const doFetch = config.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${config.url.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs ?? UPSTASH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    throw new UpstashError(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
    );
  }
  if (!response.ok) throw new UpstashError(`http_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new UpstashError('bad_response');
  }
}

/** multi-exec 응답 → 명령별 result. 하나라도 error 면 실패 */
function results(payload: unknown, expected: number): unknown[] {
  if (!Array.isArray(payload) || payload.length !== expected)
    throw new UpstashError('bad_response');
  return (payload as RestResult[]).map((entry) => {
    if (!entry || typeof entry !== 'object' || entry.error) throw new UpstashError('command_error');
    return entry.result;
  });
}

const toNumber = (value: unknown) => (typeof value === 'number' ? value : Number(value));

export async function upstashSlidingWindow(
  config: UpstashConfig,
  redisKey: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<UpstashDecision> {
  const member = `${now}-${randomUUID()}`;
  const floor = now - windowMs;
  const [, , countRaw, oldestRaw] = results(
    await restCall(config, '/multi-exec', [
      ['ZREMRANGEBYSCORE', redisKey, '0', String(floor)],
      ['ZADD', redisKey, String(now), member],
      ['ZCARD', redisKey],
      ['ZRANGE', redisKey, '0', '0', 'WITHSCORES'],
      ['PEXPIRE', redisKey, String(windowMs)],
    ]),
    5,
  );
  // ZCARD 는 정수 응답이다. null·boolean·문자열을 Number() 로 바꾸면 0/1 이 되어 허용(fail-open)되므로 거부한다 (PR-2 QA L-3)
  if (typeof countRaw !== 'number' || !Number.isSafeInteger(countRaw) || countRaw < 0)
    throw new UpstashError('bad_response');
  const count = countRaw;
  if (count <= limit) return { allowed: true, remaining: limit - count, retryAfterMs: 0 };
  // 거부: 이번 항목은 세지 않는다. 실패해도 판정은 유지(다음 요청 때 창이 밀려 사라진다)
  await restCall(config, '', ['ZREM', redisKey, member]).catch(() => undefined);
  const oldest = Array.isArray(oldestRaw) ? toNumber(oldestRaw[1]) : Number.NaN;
  const retryAfterMs = Number.isFinite(oldest) ? Math.max(0, oldest + windowMs - now) : windowMs;
  return { allowed: false, remaining: 0, retryAfterMs };
}

/** 헬스 deep 용 왕복 확인 */
export async function upstashPing(config: UpstashConfig): Promise<boolean> {
  try {
    const payload = (await restCall(config, '', ['PING'])) as RestResult;
    return payload?.result === 'PONG';
  } catch {
    return false;
  }
}

/** 백엔드 오류 기록기 — 최근 1분 실패 수가 임계를 넘으면 error 로 올린다 */
export function createBackendErrorReporter(now: () => number = Date.now) {
  let stamps: number[] = [];
  return (scope: string, error: unknown): void => {
    const at = now();
    stamps = [...stamps.filter((stamp) => stamp > at - ERROR_WINDOW_MS), at];
    const code = error instanceof UpstashError ? error.code : 'unknown';
    const fields = { scope, code, recentFailures: stamps.length };
    if (stamps.length >= BACKEND_ERROR_ESCALATE_COUNT)
      logger.error('rate_limit.backend_error', fields);
    else logger.warn('rate_limit.backend_error', fields);
  };
}
