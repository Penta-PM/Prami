import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';

import { logger } from '@/server/log';

import type { ChatGraph } from './build';
import { assertNoCostKeys, createTokenGuard, productTermsOf } from './guard';
import { fallbackReply, finishRun, initialState, runConfig, type ChatRunInput } from './run';
import type { ChatReplyOut, ChatRuntime } from './types';

/**
 * SSE 스트리밍 (PRAMI-002 §4.3.9, PR-C) — `graph.stream(streamMode: ['messages','custom','updates'])` 를 이벤트로 바꾼다.
 * - `event: token` : agent 노드의 AI 텍스트 — 문장 단위로 모아 원가 판정을 통과한 것만 (사고·도구 인자 블록 제외)
 * - `event: status`: 도구 진행 (tools 노드의 config.writer)
 * - `event: final` : compose 가 가드·금지 키 검사를 거친 최종 ChatReply — **정본**(클라이언트가 토큰 표시를 교체)
 * - `event: done`  / 오류는 `event: error`(코드만 — 예외 원문·벤더 메시지 없음)
 * 클라이언트 연결이 끊기면 request.signal → 그래프·모델 호출 signal 로 중단한다(벤더 과금 절감).
 */
export type ChatStreamEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'status'; data: { label: string } }
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

type TokenGuard = ReturnType<typeof createTokenGuard>;

function handlePart(
  mode: string,
  payload: unknown,
  emit: Emit,
  final: { reply: ChatReplyOut | null },
  guard: TokenGuard,
) {
  if (mode === 'messages') {
    const [chunk, meta] = payload as [BaseMessage, { langgraph_node?: string }];
    // 스트리밍 모델은 AIMessageChunk 조각, 비스트리밍 모델(가짜·스크립트)은 완성된 AIMessage 한 번
    if (meta?.langgraph_node !== 'agent' || chunk.getType() !== 'ai') return;
    // 문장 단위 보류 + 원가 판정을 통과한 텍스트만 (가드 전 원문이 화면에 그려지지 않게)
    const text = guard.push(chunkText(chunk));
    if (text) emit({ event: 'token', data: { text } });
  } else if (mode === 'custom') {
    const custom = payload as { type?: string; label?: string };
    if (custom.type === 'tool_status' && custom.label)
      emit({ event: 'status', data: { label: custom.label } });
  } else if (mode === 'updates') {
    const update = payload as {
      agent?: unknown;
      tools?: { messages?: unknown[] };
      compose?: { reply?: ChatReplyOut };
    };
    // 도구 결과 품명·품번은 이후 토큰 판정에서 가린다 (compose 가드와 같은 기준)
    const toolMessages = (update.tools?.messages ?? []).filter(
      (message): message is ToolMessage => message instanceof ToolMessage,
    );
    if (toolMessages.length) guard.addTerms(productTermsOf(toolMessages));
    // agent 턴 끝 → 보류 중인 마지막 조각을 판정 후 내보낸다
    if (update.agent) {
      const rest = guard.flush();
      if (rest) emit({ event: 'token', data: { text: rest } });
    }
    const reply = update.compose?.reply;
    if (reply) final.reply = reply;
  }
}

async function streamParts(
  graph: ChatGraph,
  input: ChatRunInput,
  runtime: ChatRuntime,
  signal: AbortSignal | undefined,
  emit: Emit,
) {
  const final: { reply: ChatReplyOut | null } = { reply: null };
  const guard = createTokenGuard();
  try {
    const parts = await graph.stream(initialState(input), {
      ...runConfig(runtime),
      streamMode: ['messages', 'custom', 'updates'],
      ...(signal ? { signal } : {}),
    });
    for await (const [mode, payload] of parts as AsyncIterable<[string, unknown]>)
      handlePart(mode, payload, emit, final, guard);
  } catch (error) {
    if (!(error instanceof GraphRecursionError)) throw error;
    final.reply = fallbackReply(runtime);
  }
  return final.reply;
}

/** SSE 본문 스트림. 예외는 코드만 담은 error 이벤트로 끝낸다 */
export function streamChat(
  graph: ChatGraph,
  input: ChatRunInput,
  runtime: ChatRuntime,
  signal?: AbortSignal,
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
