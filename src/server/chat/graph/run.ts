import { GraphRecursionError } from '@langchain/langgraph';

import { logger } from '@/server/log';

import type { ChatGraph } from './build';
import type { HistoryItem } from './history';
import { RECURSION_REPLY } from './messages';
import type { ChatReplyOut, ChatRuntime } from './types';

/**
 * 그래프 1회 실행 (PRAMI-002 §4.3). 대화는 저장하지 않는다(I-6). 구조화 로그에는 메타데이터만 — 벤더·모델·경로·LLM 호출 수·지연.
 * recursionLimit = 2 × 도구 상한 + 6 (§4.3.3). GraphRecursionError 는 "더 구체적으로" 안내로 마무리한다.
 */
export type ChatRunInput = {
  text: string;
  truncated: boolean;
  history: HistoryItem[];
  actor: { userId: string; role: 'USER' | 'ADMIN' };
};

export function recursionLimitFor(maxToolCalls: number): number {
  return 2 * maxToolCalls + 6;
}

export function fallbackReply(runtime: ChatRuntime): ChatReplyOut {
  const credential = runtime.credential;
  return {
    intent: 'help',
    reply: RECURSION_REPLY,
    candidates: [],
    showProductChips: false,
    action: null,
    mode: 'llm',
    llm: { status: 'ready', vendor: credential?.vendor ?? null, model: credential?.model ?? null },
  };
}

export function initialState(input: ChatRunInput) {
  return {
    input: { text: input.text, truncated: input.truncated },
    history: input.history,
    actor: input.actor,
  };
}

export function runConfig(runtime: ChatRuntime) {
  return {
    configurable: { runtime },
    recursionLimit: recursionLimitFor(runtime.settings.maxToolCalls),
  };
}

/** 성공한 LLM 경로면 last_used_at, 구조화 로그는 메타데이터만 (JSON·SSE 공통) */
export async function finishRun(
  reply: ChatReplyOut,
  runtime: ChatRuntime,
  started: number,
  streamed = false,
) {
  if (reply.mode === 'llm' && runtime.credential) await runtime.markUsed(runtime.credential);
  logger.info('chat.answer', {
    mode: reply.mode,
    llmStatus: reply.llm.status,
    vendor: reply.llm.vendor,
    model: reply.llm.model,
    llmCalls: runtime.llmCalls,
    setup: reply.setup?.status ?? null,
    streamed,
    ms: Date.now() - started,
  });
}

export async function runChat(
  graph: ChatGraph,
  input: ChatRunInput,
  runtime: ChatRuntime,
): Promise<ChatReplyOut> {
  const started = Date.now();
  let reply: ChatReplyOut;
  try {
    const result = await graph.invoke(initialState(input), runConfig(runtime));
    reply = result.reply!;
  } catch (error) {
    if (!(error instanceof GraphRecursionError)) throw error;
    reply = fallbackReply(runtime);
  }
  await finishRun(reply, runtime, started);
  return reply;
}
