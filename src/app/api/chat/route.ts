import { z } from 'zod';

import { getDb } from '@/db';
import { AppError } from '@/lib/result';
import { runRoute } from '@/server/auth/rbac';
import { CHAT_MAX_LENGTH, normalizeMessage } from '@/server/chat/intent';
import { rateLimiters, retryAfterSeconds } from '@/server/rate-limit';
import { respondToChat, type ChatReply } from '@/server/chat/respond';

/**
 * POST /api/chat (§4.5.9, §4.7, chat.use = 로그인 사용자 모두): 규칙 기반 챗봇. 대화는 저장하지 않고 감사도 남기지 않는다
 * (권한 거부만 runRoute 가 기록). 사용자당 분당 RATE_LIMIT_PER_MIN 회(§4.8 r6) 초과 → 429. 입력은 길이·제어 문자 정리(검색과 같은 규칙).
 * 응답에는 원가 키가 없다 — server/chat 은 sales_prices 만 읽는다 (AC-43·81).
 */
export const AUDIT_CHAT_ASK = 'chat.ask';

/** 규칙 기반 — DB 조회 몇 번이면 끝난다 */
export const maxDuration = 10;

const bodySchema = z.object({
  message: z.string().max(CHAT_MAX_LENGTH * 4, '메시지가 너무 깁니다'),
});

type ParsedMessage = { message: string; truncated: boolean };

/** 200자 넘게 보내면 앞 200자만 쓰고 응답에 안내를 붙인다 (PR-10 QA I-3) */
export const TRUNCATED_NOTICE = `질문이 ${CHAT_MAX_LENGTH}자를 넘어 앞 ${CHAT_MAX_LENGTH}자만 사용했습니다.`;

async function parseBody(request: Request): Promise<ParsedMessage> {
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
  const full = parsed.data.message.replace(/\s+/g, ' ').trim();
  return { message, truncated: full.length > CHAT_MAX_LENGTH };
}

export async function POST(request: Request): Promise<Response> {
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_ASK,
    target: '/api/chat',
  } as const;
  return runRoute(guard, async (user) => {
    const { message, truncated } = await parseBody(request);
    const decision = rateLimiters.chat.hit(user.id);
    if (!decision.allowed) {
      const retryAfter = retryAfterSeconds(decision);
      throw new AppError(
        'RATE_LIMITED',
        `요청이 너무 잦습니다. ${retryAfter}초 후 다시 시도하세요`,
        undefined,
        {
          retryAfterSeconds: retryAfter,
        },
      );
    }
    const answer = await respondToChat(await getDb(), { role: user.role }, message);
    const data: ChatReply = truncated ? { ...answer, notice: TRUNCATED_NOTICE } : answer;
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
