/**
 * 챗봇 호출 속도 제한 (§4.8): 사용자당 분당 CHAT_RATE_LIMIT 회, 슬라이딩 윈도우, 프로세스 메모리.
 * Vercel 서버리스는 인스턴스마다 메모리가 따로라 상한이 "인스턴스당" 으로 느슨해진다 — 공유 저장소(KV) 전환은 PR-11/운영 판단.
 * 대화는 저장하지 않으므로(§4.5.9) 여기서도 메시지 내용은 다루지 않는다.
 */
export const CHAT_RATE_LIMIT = 30;
export const CHAT_RATE_WINDOW_MS = 60_000;

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** 다음 허용까지 남은 ms (허용이면 0) */
  retryAfterMs: number;
};

export type RateLimiter = {
  hit: (key: string, now?: number) => RateLimitDecision;
  reset: () => void;
};

export function createRateLimiter(
  limit: number = CHAT_RATE_LIMIT,
  windowMs: number = CHAT_RATE_WINDOW_MS,
): RateLimiter {
  const buckets = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const floor = now - windowMs;
      const recent = (buckets.get(key) ?? []).filter((stamp) => stamp > floor);
      if (recent.length >= limit) {
        buckets.set(key, recent);
        return { allowed: false, remaining: 0, retryAfterMs: recent[0]! + windowMs - now };
      }
      const next = [...recent, now];
      buckets.set(key, next);
      // 오래 안 온 사용자의 버킷은 정리 (메모리 상한)
      if (buckets.size > 10_000) {
        for (const [otherKey, stamps] of buckets) {
          if (stamps.every((stamp) => stamp <= floor)) buckets.delete(otherKey);
        }
      }
      return { allowed: true, remaining: limit - next.length, retryAfterMs: 0 };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** Route 가 쓰는 프로세스 단일 인스턴스 */
export const chatRateLimiter = createRateLimiter();
