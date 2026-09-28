import { describe, expect, it } from 'vitest';

import { CHAT_RATE_LIMIT, createRateLimiter } from '@/server/chat/rate-limit';

/** 사용자당 분당 N회 슬라이딩 윈도우 (§4.8) */
describe('createRateLimiter', () => {
  it('상한까지 허용하고 그 다음은 거부, 창이 지나면 다시 허용, 사용자별 독립', () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter.hit('u1', 0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.hit('u1', 100)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.hit('u1', 200)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.hit('u1', 300)).toMatchObject({ allowed: false, retryAfterMs: 700 });
    expect(limiter.hit('u2', 300)).toMatchObject({ allowed: true, remaining: 2 });
    // 첫 요청(0ms)이 창 밖으로 나가면 한 번 더
    expect(limiter.hit('u1', 1001)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.hit('u1', 1002)).toMatchObject({ allowed: false });
    limiter.reset();
    expect(limiter.hit('u1', 1003)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('기본값은 분당 30회', () => {
    const limiter = createRateLimiter();
    for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) {
      expect(limiter.hit('u', index).allowed).toBe(true);
    }
    expect(limiter.hit('u', CHAT_RATE_LIMIT).allowed).toBe(false);
    expect(CHAT_RATE_LIMIT).toBe(30);
  });
});
