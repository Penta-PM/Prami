import { z } from 'zod';

import { getDb } from '@/db';
import { env } from '@/env';
import { AppError } from '@/lib/result';
import { runRoute } from '@/server/auth/rbac';
import { HistorySchema } from '@/server/chat/graph/history';
import { TRUNCATED_NOTICE } from '@/server/chat/graph/messages';
import { runChat } from '@/server/chat/graph/run';
import { streamChat } from '@/server/chat/graph/stream';
import { chatGraph, createChatRuntime } from '@/server/chat/graph/runtime';
import { CHAT_MAX_LENGTH, normalizeMessage } from '@/server/chat/intent';
import { rateLimiters, retryAfterSeconds } from '@/server/rate-limit';
import { REQUEST_ID_HEADER } from '@/server/security/headers';

/**
 * POST /api/chat (PRAMI-001 §4.5.9 → PRAMI-002 §4.3.11, chat.use): LangGraph 그래프로 답한다 — 키가 없거나 LLM 이 실패하면
 * 기존 규칙 엔진(ruleAnswer 노드)으로 폴백한다. 대화는 저장하지 않고 감사도 남기지 않는다(권한 거부만 runRoute 가 기록).
 * 사용자당 분당 RATE_LIMIT_PER_MIN 회 — LLM·규칙 경로가 기존 chat 버킷을 공유(AC-95). 응답에 원가 키·API 키가 없다.
 * LLM 경로 오류는 HTTP 200 + data.setup/notice 로 대화 안에서 안내한다(§4.8.3).
 * `Accept: text/event-stream` 이면 SSE(token·status·final·done, §4.3.9 — PR-C), 없으면 기존 JSON 그대로.
 */
export const AUDIT_CHAT_ASK = 'chat.ask';
export { TRUNCATED_NOTICE };

/** LLM 경로(도구 루프 포함) 상한 (§4.8.1) */
export const maxDuration = 60;
/** LangGraph 가 AsyncLocalStorage 를 쓴다 */
export const runtime = 'nodejs';

const bodySchema = z
  .object({
    message: z.string().max(CHAT_MAX_LENGTH * 4, '메시지가 너무 깁니다'),
    history: HistorySchema.optional(),
  })
  .strict();

type ParsedBody = { message: string; truncated: boolean; history: z.infer<typeof HistorySchema> };

async function parseBody(request: Request): Promise<ParsedBody> {
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
  return { message, truncated: full.length > CHAT_MAX_LENGTH, history: parsed.data.history ?? [] };
}

async function rateLimit(userId: string) {
  const decision = await rateLimiters.chat.hit(userId);
  if (decision.allowed) return decision;
  const retryAfter = retryAfterSeconds(decision);
  throw new AppError(
    'RATE_LIMITED',
    `요청이 너무 잦습니다. ${retryAfter}초 후 다시 시도하세요`,
    undefined,
    { retryAfterSeconds: retryAfter },
  );
}

/** `Accept: text/event-stream` 이면 SSE, 아니면 기존 JSON 봉투 (호환 유지) */
function wantsEventStream(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('text/event-stream');
}

export async function POST(request: Request): Promise<Response> {
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_ASK,
    target: '/api/chat',
  } as const;
  return runRoute(guard, async (user) => {
    const { message, truncated, history } = await parseBody(request);
    const decision = await rateLimit(user.id);
    const db = await getDb();
    const input = {
      text: message,
      truncated,
      history,
      actor: { userId: user.id, role: user.role },
    };
    const chatRuntime = createChatRuntime({
      db,
      userId: user.id,
      env,
      requestId: request.headers.get(REQUEST_ID_HEADER),
    });
    if (wantsEventStream(request)) {
      // SSE 옵트인 (§4.3.9) — 연결이 끊기면 request.signal 로 그래프·모델 호출을 중단한다
      return new Response(streamChat(chatGraph, input, chatRuntime, request.signal), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
          'x-ratelimit-remaining': String(decision.remaining),
        },
      });
    }
    const data = await runChat(chatGraph, input, chatRuntime);
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
