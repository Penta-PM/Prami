import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';

import { logger } from '@/server/log';

import type { ChatGraph } from './build';
import { assertNoCostKeys, createTokenGuard, productTermsOf } from './guard';
import { isRefusal } from './refusal';
import { fallbackReply, finishRun, initialState, runConfig, type ChatRunInput } from './run';
import type { ChatReplyOut, ChatRuntime } from './types';

/**
 * SSE 스트리밍 (PRAMI-002 §4.3.9, PR-C) — `graph.stream(streamMode: ['messages','custom','updates'])` 를 이벤트로 바꾼다.
 * - `event: token` : agent 노드의 AI 텍스트 — 문장 단위로 모아 원가 판정을 통과한 것만 (사고·도구 인자 블록 제외)
 * - `event: status`: 도구 진행 (tools 노드의 config.writer)
 * - `event: discard`: 벤더 거부(refusal)를 알았을 때 이미 보낸 토큰이 있으면 1회 — 클라이언트는 즉시 말풍선 텍스트를 비우고
 *   대화 히스토리에도 남기지 않는다(QA L-1, Main 결정 A). 실 Anthropic 스트리밍은 stop_reason 이 텍스트 뒤 별도 청크로 와서
 *   거부 전에 끝난 문장은 이미 나갔을 수 있다 — 벤더 권고(부분 출력 폐기)대로 버리고, 그 문장도 출력 가드는 거쳤다.
 *   agent 가 그 밖의 오류로 출력을 버린 경우(스트림 도중 오류, xAI 서버측 도구 사후 검사 — PRAMI-003 §4.7.7 ③)도 같다
 *   (`reason: 'llm_error'`, final 은 규칙 답).
 * - `event: final` : compose 가 가드·금지 키 검사를 거친 최종 ChatReply — **정본**(클라이언트가 토큰 표시를 교체)
 * - `event: done`  / 오류는 `event: error`(코드만 — 예외 원문·벤더 메시지 없음)
 * 클라이언트 연결이 끊기면 request.signal → 그래프·모델 호출 signal 로 중단한다(벤더 과금 절감).
 */
export type ChatStreamEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'status'; data: { label: string } }
  | { event: 'discard'; data: { reason: DiscardReason } }
  | { event: 'final'; data: ChatReplyOut }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: { code: string } };

export function encodeSse({ event, data }: ChatStreamEvent): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** AI 청크에서 사용자에게 보일 텍스트만 (Anthropic 사고 블록·도구 인자 조각은 버린다) */
function chunkText(chunk: BaseMessage): string {
  if (typeof chunk.content === 'string') return chunk.content;
  return chunk.content
    .map((block) => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
    .join('');
}

type Emit = (event: ChatStreamEvent) => void;

type DiscardReason = 'refusal' | 'llm_error';

type TokenGuard = ReturnType<typeof createTokenGuard>;

/** 요청 하나의 스트림 상태 */
type StreamState = {
  reply: ChatReplyOut | null;
  guard: TokenGuard;
  tokensSent: boolean;
  refused: boolean;
};

function sendToken(state: StreamState, emit: Emit, text: string) {
  if (!text) return;
  state.tokensSent = true;
  emit({ event: 'token', data: { text } });
}

/** refusal·오류: 보류분을 버리고, 이미 토큰을 보냈으면 discard 1회 (완성 메시지 refusal 은 토큰 0 이라 discard 도 없음) */
function refuse(state: StreamState, emit: Emit, reason: DiscardReason = 'refusal') {
  if (state.refused) return;
  state.refused = true;
  state.guard.discard();
  if (state.tokensSent) emit({ event: 'discard', data: { reason } });
}

function onMessage(payload: unknown, emit: Emit, state: StreamState) {
  const [chunk, meta] = payload as [BaseMessage, { langgraph_node?: string }];
  // 스트리밍 모델은 AIMessageChunk 조각, 비스트리밍 모델(가짜·스크립트)은 완성된 AIMessage 한 번
  if (meta?.langgraph_node !== 'agent' || chunk.getType() !== 'ai') return;
  if (isRefusal(chunk)) return refuse(state, emit);
  // 문장 단위 보류 + 원가 판정을 통과한 텍스트만 (가드 전 원문이 화면에 그려지지 않게)
  sendToken(state, emit, state.guard.push(chunkText(chunk)));
}

function onUpdate(payload: unknown, emit: Emit, state: StreamState) {
  const update = payload as {
    agent?: { llmError?: string };
    tools?: { messages?: unknown[] };
    compose?: { reply?: ChatReplyOut };
  };
  // 도구 결과 품명·품번은 이후 토큰 판정에서 가린다 (compose 가드와 같은 기준)
  const toolMessages = (update.tools?.messages ?? []).filter(
    (message): message is ToolMessage => message instanceof ToolMessage,
  );
  if (toolMessages.length) state.guard.addTerms(productTermsOf(toolMessages));
  // agent 턴 끝 → refusal·오류(출력 폐기)면 폐기, 아니면 보류 중인 마지막 조각을 판정 후 내보낸다
  const llmError = update.agent?.llmError;
  if (llmError) refuse(state, emit, llmError === 'refused' ? 'refusal' : 'llm_error');
  else if (update.agent) sendToken(state, emit, state.guard.flush());
  if (update.compose?.reply) state.reply = update.compose.reply;
}

function handlePart(mode: string, payload: unknown, emit: Emit, state: StreamState) {
  if (mode === 'messages') onMessage(payload, emit, state);
  else if (mode === 'updates') onUpdate(payload, emit, state);
  else if (mode === 'custom') {
    const custom = payload as { type?: string; label?: string };
    if (custom.type === 'tool_status' && custom.label)
      emit({ event: 'status', data: { label: custom.label } });
  }
}

async function streamParts(
  graph: ChatGraph,
  input: ChatRunInput,
  runtime: ChatRuntime,
  signal: AbortSignal | undefined,
  emit: Emit,
) {
  runtime.streaming = true;
  const state: StreamState = {
    reply: null,
    guard: createTokenGuard(),
    tokensSent: false,
    refused: false,
  };
  try {
    const parts = await graph.stream(initialState(input), {
      ...runConfig(runtime),
      streamMode: ['messages', 'custom', 'updates'],
      ...(signal ? { signal } : {}),
    });
    for await (const [mode, payload] of parts as AsyncIterable<[string, unknown]>)
      handlePart(mode, payload, emit, state);
  } catch (error) {
    if (!(error instanceof GraphRecursionError)) throw error;
    state.reply = fallbackReply(runtime);
  }
  return state.reply;
}

/**
 * 최종 응답 훅 (대화 저장 PR-C1): 가드·금지 키 검사를 통과한 reply 로 `final` 을 보내기 **전에** 부른다 — 화면이 받는 정본과
 * 저장본이 같다. 훅이 실패하면 final 대신 error 이벤트. 스트림이 실패·중단되면 부르지 않는다.
 */
export type StreamHooks = { onFinal?: (reply: ChatReplyOut) => Promise<void> };

/** SSE 본문 스트림. 예외는 코드만 담은 error 이벤트로 끝낸다 */
export function streamChat(
  graph: ChatGraph,
  input: ChatRunInput,
  runtime: ChatRuntime,
  signal?: AbortSignal,
  hooks: StreamHooks = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const started = Date.now();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => controller.enqueue(encoder.encode(encodeSse(event)));
      try {
        const reply = await streamParts(graph, input, runtime, signal, emit);
        if (!reply) throw new Error('compose 결과 없음');
        assertNoCostKeys(reply);
        await hooks.onFinal?.(reply);
        emit({ event: 'final', data: reply });
        emit({ event: 'done', data: {} });
        await finishRun(reply, runtime, started, true);
      } catch (error) {
        if (!signal?.aborted) {
          logger.error('chat.stream_failed', { error });
          emit({ event: 'error', data: { code: 'INTERNAL' } });
        }
      } finally {
        controller.close();
      }
    },
  });
}
