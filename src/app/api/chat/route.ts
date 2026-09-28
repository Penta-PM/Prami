import { z } from 'zod';

import { getDb } from '@/db';
import { AppError } from '@/lib/result';
import { runRoute } from '@/server/auth/rbac';
import { CHAT_MAX_LENGTH, normalizeMessage } from '@/server/chat/intent';
import { chatRateLimiter } from '@/server/chat/rate-limit';
import { respondToChat, type ChatReply } from '@/server/chat/respond';

/**
 * POST /api/chat (§4.5.9, §4.7, chat.use = 로그인 사용자 모두): 규칙 기반 챗봇. 대화는 저장하지 않고 감사도 남기지 않는다
 * (권한 거부만 runRoute 가 기록). 사용자당 분당 CHAT_RATE_LIMIT 회(§4.8) 초과 → 429. 입력은 길이·제어 문자 정리(검색과 같은 규칙).
 * 응답에는 원가 키가 없다 — server/chat 은 sales_prices 만 읽는다 (AC-43·81).
 */
export const AUDIT_CHAT_ASK = 'chat.ask';

const bodySchema = z.object({
  message: z.string().max(CHAT_MAX_LENGTH * 4, '메시지가 너무 깁니다'),
});

async function parseBody(request: Request): Promise<string> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('VALIDATION', '요청 본문은 JSON 이어야 합니다');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new AppError('VALIDATION', '메시지가 비어 있거나 너무 깁니다');
  const message = normalizeMessage(parsed.data.message);
  if (!message) throw new AppError('VALIDATION', '메시지를 입력하세요');
  return message;
}

export async function POST(request: Request): Promise<Response> {
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_ASK,
    target: '/api/chat',
  } as const;
  return runRoute(guard, async (user) => {
    const message = await parseBody(request);
    const decision = chatRateLimiter.hit(user.id);
    if (!decision.allowed) {
      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      throw new AppError(
        'RATE_LIMITED',
        `요청이 너무 잦습니다. ${retryAfter}초 후 다시 시도하세요`,
        undefined,
        {
          retryAfterSeconds: retryAfter,
        },
      );
    }
    const data: ChatReply = await respondToChat(await getDb(), { role: user.role }, message);
    return Response.json(
      { ok: true, data },
      {
        headers: {
          'cache-control': 'no-store',
          'x-ratelimit-remaining': String(decision.remaining),
        },
      },
    );
  });
}
