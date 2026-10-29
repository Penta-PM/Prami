import { z } from 'zod';

import { getDb, getDbHandle } from '@/db';
import { env } from '@/env';
import { CHAT_DOMAINS } from '@/lib/chat/conversations';
import { AppError } from '@/lib/result';
import { runRoute } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import { chatOwner } from '@/server/chat/conversation-owner';
import { beginTurn, completeTurn } from '@/server/chat/conversations';
import { chatGraphFor } from '@/server/chat/domains';
import { HistorySchema } from '@/server/chat/graph/history';
import { TRUNCATED_NOTICE } from '@/server/chat/graph/messages';
import { runChat, type ChatRunInput } from '@/server/chat/graph/run';
import { streamChat, type StreamHooks } from '@/server/chat/graph/stream';
import { createChatRuntime } from '@/server/chat/graph/runtime';
import { CHAT_MAX_LENGTH, normalizeMessage } from '@/server/chat/intent';
import { rateLimiters, retryAfterSeconds } from '@/server/rate-limit';
import { REQUEST_ID_HEADER } from '@/server/security/headers';

/**
 * POST /api/chat (PRAMI-001 §4.5.9 → PRAMI-002 §4.3.11, chat.use): LangGraph 그래프로 답한다 — 키가 없거나 LLM 이 실패하면
 * 기존 규칙 엔진(ruleAnswer 노드)으로 폴백한다. 감사는 남기지 않는다(권한 거부만 runRoute 가 기록).
 * 대화 저장(UX 4건 PR-C1, I-6 개정):
 * - `conversationId` + `domain` 이 있으면 **저장 대화** — 소유·domain 일치(다르면 404)·권한·메시지 상한을 확인하고 질문을 저장한 뒤
 *   history 를 **DB 에서** 읽는다(본문 history 는 무시). 가드를 통과한 최종 답 텍스트·액션만 final 직전에 저장한다.
 *   답이 실패·중단되면 질문만 남는다(같은 질문 다시 보내기 = 재사용, 중복 저장 없음).
 * - `conversationId` 가 없으면 기존 무저장 경로 그대로(도킹 패널 호환 — PR-C2 가 패널을 걷어 낼 때까지). 이 경로는 pricing 만.
 * - 그래프는 domain 별(PR-C3, server/chat/domains): 저장 대화면 beginTurn 이 검증한 대화 domain, 무저장이면 pricing.
 *   가격 대화에는 조달 도구가, 조달 대화에는 가격 도구가 노출·실행되지 않는다.
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
    /** 저장 대화 id (없으면 무저장 경로) */
    conversationId: z.string().max(64).optional(),
    /** 요청 경로의 챗봇 domain — 저장 대화면 필수 */
    domain: z.enum(CHAT_DOMAINS).optional(),
  })
  .strict();

type ParsedBody = {
  message: string;
  /** 사용자가 보낸 원문(앞뒤 공백 제거) — 저장용 */
  original: string;
  truncated: boolean;
  history: z.infer<typeof HistorySchema>;
  conversation: { id: string; domain: (typeof CHAT_DOMAINS)[number] } | null;
};

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
  const { conversationId, domain } = parsed.data;
  if (conversationId === undefined && domain !== undefined && domain !== 'pricing') {
    throw new AppError('VALIDATION', '대화를 먼저 만드세요');
  }
  if (conversationId !== undefined && domain === undefined) {
    throw new AppError('VALIDATION', '챗봇 구분(domain)이 필요합니다');
  }
  return {
    message,
    original: parsed.data.message.trim(),
    truncated: full.length > CHAT_MAX_LENGTH,
    history: parsed.data.history ?? [],
    conversation: conversationId !== undefined ? { id: conversationId, domain: domain! } : null,
  };
}

/** 저장 대화면 질문 저장 + DB history 로 입력을 바꾸고 최종 응답 저장 훅을 돌려준다. 아니면 그대로 */
async function persistence(
  user: SessionUser,
  body: ParsedBody,
  input: ChatRunInput,
  historyMaxTurns: number,
): Promise<{ input: ChatRunInput; hooks: StreamHooks }> {
  if (!body.conversation) return { input, hooks: {} };
  const handle = await getDbHandle();
  const owner = chatOwner(user, '/api/chat', AUDIT_CHAT_ASK);
  const turn = await beginTurn(handle, owner, {
    conversationId: body.conversation.id,
    domain: body.conversation.domain,
    message: body.original,
    historyMaxTurns,
  });
  return {
    input: { ...input, history: turn.history },
    hooks: {
      onFinal: async (reply) => {
        await completeTurn(handle, owner, turn.conversationId, reply);
      },
    },
  };
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
    const body = await parseBody(request);
    const decision = await rateLimit(user.id);
    const db = await getDb();
    const chatRuntime = createChatRuntime({
      db,
      userId: user.id,
      env,
      requestId: request.headers.get(REQUEST_ID_HEADER),
    });
    const { input, hooks } = await persistence(
      user,
      body,
      {
        text: body.message,
        truncated: body.truncated,
        history: body.history,
        actor: { userId: user.id, role: user.role },
      },
      chatRuntime.settings.historyMaxTurns,
    );
    const chatGraph = chatGraphFor(body.conversation?.domain ?? 'pricing');
    if (wantsEventStream(request)) {
      // SSE 옵트인 (§4.3.9) — 연결이 끊기면 request.signal 로 그래프·모델 호출을 중단한다
      return new Response(streamChat(chatGraph, input, chatRuntime, request.signal, hooks), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
          'x-ratelimit-remaining': String(decision.remaining),
        },
      });
    }
    const data = await runChat(chatGraph, input, chatRuntime);
    await hooks.onFinal?.(data);
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
