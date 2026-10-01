/**
 * xAI Responses API 전송 계층 스텁 (PRAMI-003 §4.7.3, AC-356). 실제로 나가는 요청(URL·헤더·본문)을 기록하고 스크립트한
 * 응답을 돌려준다. 실벤더로는 아무것도 나가지 않는다.
 *
 * 공식 문서(2026-10-01 확인)와 맞춘 점:
 * - 스트리밍은 "data-only server-sent events", `data: [DONE]` 으로 끝난다
 *   (https://docs.x.ai/developers/rest-api-reference/inference/responses) → `event:` 줄 없이 `data:` 만 보낸다
 * - "With streaming, the function call is returned in whole in a single chunk, not streamed across chunks."
 *   (https://docs.x.ai/developers/tools/function-calling) → 함수 호출은 `output_item.added` 한 조각에 인자 전체, 델타 없음
 * - `grok-4.7` 은 "always returns `reasoning.encrypted_content`" → 추론 항목은 암호화 내용만
 * - 오류 본문은 문서에 형식이 없어 Plan 조사 중 더미 키 관측 형태(`{"code": "...", "error": "..."}`)를 쓴다
 * - (r3, B-1) 실 API 는 본문에 `search_parameters` 가 있으면 `mode:'off'` 여도 410 을 돌려준다(PR #22 QA 더미 키 관측) —
 *   스텁도 기본으로 같게 동작한다(`rejectSearchParameters: false` 로 끈다)
 * - (r3) 응답 `usage` 의 `num_server_side_tools_used`·`num_sources_used`(rest-api-reference/inference/responses) — 턴별 지정
 * 이벤트 `type` 이름은 문서에 목록이 없다(UNVERIFIED) — OpenAI Responses 와 같은 이름이라고 가정한다.
 */
import type { CapturedRequest } from './anthropic-http';

/** 응답 usage 의 서버측 도구 필드 (§4.7.7 ③ 사후 검사 픽스처) */
export type XaiUsage = { num_server_side_tools_used?: number; num_sources_used?: number };

export type XaiTurn =
  | { text: string; usage?: XaiUsage; serverToolItem?: true }
  | { toolCall: { name: string; args: Record<string, unknown> } }
  /** `refusalEvents: false` = 거부를 `output_item.done` 항목에만 싣는다(델타·done 이벤트 없음 — 이벤트명 UNVERIFIED 최악 경우) */
  | { refusal: string; refusalEvents?: false }
  | { incomplete: 'max_output_tokens' | 'content_filter'; text?: string }
  | { error: { status: number; body: unknown; headers?: Record<string, string> } }
  | { networkError: true }
  | { hang: true };

type Item = { type: string; id: string; [field: string]: unknown };

export const XAI_ENCRYPTED_REASONING = 'enc-xai-reasoning-1';

/** PR #22 QA 더미 키 관측 본문 그대로 (`code` 없음) */
export const XAI_LIVE_SEARCH_410 = {
  error:
    'Live search is deprecated. Please switch to the Agent Tools API: https://docs.x.ai/docs/guides/tools/overview',
};

/** 서버측 검색 도구 출력 항목 (Responses 의 web_search_call 형식 가정 — 함수·메시지·추론이 아닌 항목) */
const SERVER_TOOL_ITEM: Item = {
  type: 'web_search_call',
  id: 'ws_xai_1',
  status: 'completed',
  action: { type: 'search', query: 'Wapples-500' },
};

function outputOf(turn: XaiTurn): Item[] {
  const reasoning = {
    type: 'reasoning',
    id: 'rs_xai_1',
    summary: [],
    encrypted_content: XAI_ENCRYPTED_REASONING,
  };
  if ('toolCall' in turn) {
    return [
      reasoning,
      {
        type: 'function_call',
        id: 'fc_xai_1',
        call_id: 'call_xai_1',
        name: turn.toolCall.name,
        arguments: JSON.stringify(turn.toolCall.args),
        status: 'completed',
      },
    ];
  }
  const content =
    'refusal' in turn
      ? [{ type: 'refusal', refusal: turn.refusal }]
      : [
          {
            type: 'output_text',
            text: 'text' in turn ? (turn.text ?? '') : '',
            annotations: [],
          },
        ];
  const message = {
    type: 'message',
    id: 'msg_xai_1',
    role: 'assistant',
    status: 'completed',
    content,
  };
  return 'serverToolItem' in turn ? [reasoning, SERVER_TOOL_ITEM, message] : [reasoning, message];
}

function responseBody(turn: XaiTurn, model: string, status = 'completed') {
  const incomplete = 'incomplete' in turn;
  return {
    id: 'resp_xai_1',
    object: 'response',
    created_at: 1,
    status: incomplete ? 'incomplete' : status,
    ...(incomplete ? { incomplete_details: { reason: turn.incomplete } } : {}),
    model,
    output: status === 'in_progress' ? [] : outputOf(turn),
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      // 서버측 도구 사용량은 완료 응답에만 (생성 이벤트의 in_progress 응답에는 없다)
      ...('usage' in turn && status !== 'in_progress' ? turn.usage : {}),
    },
  };
}

/** data-only SSE: 함수 호출은 added 한 조각에 인자 전체(델타 없음), 텍스트는 델타, 끝에 [DONE] */
function streamOf(turn: XaiTurn, model: string, chunked = false): Response {
  const events: Record<string, unknown>[] = [
    { type: 'response.created', response: responseBody(turn, model, 'in_progress') },
  ];
  outputOf(turn).forEach((item, outputIndex) => {
    if (item.type === 'message') {
      events.push({
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: { ...item, content: [] },
      });
      const part = (item.content as { type: string; text?: string; refusal?: string }[])[0]!;
      const at = { item_id: item.id, output_index: outputIndex, content_index: 0 };
      if (part.type === 'output_text') {
        events.push({ type: 'response.output_text.delta', ...at, delta: part.text });
      }
      // refusal 은 OpenAI Responses 와 같은 이벤트 이름 가정 (refusal.delta → refusal.done)
      if (part.type === 'refusal' && !('refusalEvents' in turn && turn.refusalEvents === false)) {
        events.push({ type: 'response.refusal.delta', ...at, delta: part.refusal });
        events.push({ type: 'response.refusal.done', ...at, refusal: part.refusal });
      }
    } else {
      events.push({ type: 'response.output_item.added', output_index: outputIndex, item });
    }
    events.push({ type: 'response.output_item.done', output_index: outputIndex, item });
  });
  const last = 'incomplete' in turn ? 'response.incomplete' : 'response.completed';
  events.push({ type: last, response: responseBody(turn, model) });
  const parts = [
    ...events.map(
      (event, index) => `data: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`,
    ),
    'data: [DONE]\n\n',
  ];
  return new Response(chunked ? chunkedBody(parts) : parts.join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * `chunked` = 이벤트마다 별도 청크로, 청크 사이에 잠깐 쉰다(실 네트워크처럼 텍스트 델타가 완료 이벤트보다 먼저 도착 —
 * SSE 사후 검사의 discard 경로 확인용). 기본은 본문 한 덩어리.
 */
function chunkedBody(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (index >= parts.length) return controller.close();
      controller.enqueue(encoder.encode(parts[index]!));
      index += 1;
    },
  });
}

function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (init?.signal?.aborted) return fail();
    init?.signal?.addEventListener('abort', fail, { once: true });
  });
}

export function createXaiStub(
  turns: XaiTurn[],
  { rejectSearchParameters = true, chunked = false } = {},
) {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((value, key) => {
      headers[key] = value;
    });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ url: String(url), headers, body });
    const turn = turns[Math.min(index, turns.length - 1)]!;
    index += 1;
    if (rejectSearchParameters && 'search_parameters' in body) {
      return Response.json(XAI_LIVE_SEARCH_410, { status: 410 });
    }
    if ('hang' in turn) return hang(init);
    if ('networkError' in turn) throw new TypeError('fetch failed');
    if ('error' in turn) {
      return Response.json(turn.error.body, {
        status: turn.error.status,
        headers: turn.error.headers,
      });
    }
    const model = typeof body.model === 'string' ? body.model : 'grok-4.7';
    return body.stream === true
      ? streamOf(turn, model, chunked)
      : Response.json(responseBody(turn, model));
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}
