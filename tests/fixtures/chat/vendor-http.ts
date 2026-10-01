/**
 * OpenAI Responses·Chat Completions · Gemini generateContent 전송 계층 스텁 (PRAMI-002 AC-241·AC-243). 실제로 나가는 요청(URL·헤더·본문)을
 * 기록하고 스크립트한 응답을 돌려준다 — 비스트리밍 JSON 과 SSE(stream:true / streamGenerateContent?alt=sse) 모두.
 * 실벤더로는 아무것도 나가지 않는다.
 */
import type { CapturedRequest } from './anthropic-http';

export type VendorTurn =
  | { text: string }
  | { toolCall: { name: string; args: Record<string, unknown> } }
  /** Responses 전용 (PRAMI-003 L-1): refusal 콘텐츠 부분 */
  | { refusal: string }
  /** Responses 전용 (PRAMI-003 L-1): status incomplete + incomplete_details.reason, 부분 텍스트 선택 */
  | {
      incomplete: {
        reason: 'max_output_tokens' | 'content_filter';
        text?: string;
        toolCall?: { name: string; args: Record<string, unknown> };
      };
    }
  | { error: { status: number; body: unknown; headers?: Record<string, string> } }
  | { hang: true };

type Stub = { fetch: typeof fetch; requests: CapturedRequest[] };

function capture(requests: CapturedRequest[], url: string, init?: RequestInit) {
  const headers: Record<string, string> = {};
  new Headers(init?.headers as HeadersInit).forEach((value, key) => {
    headers[key] = value;
  });
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  requests.push({ url, headers, body });
  return body;
}

function sse(events: unknown[], done = false): Response {
  const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(`${lines}${done ? 'data: [DONE]\n\n' : ''}`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 신호가 끊길 때까지 응답하지 않는 요청 (타임아웃·중단 관찰) */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (init?.signal?.aborted) return fail();
    init?.signal?.addEventListener('abort', fail, { once: true });
  });
}

function openAiMessage(turn: VendorTurn) {
  if ('toolCall' in turn) {
    const call = {
      id: 'call_1',
      type: 'function',
      function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.args) },
    };
    return {
      message: { role: 'assistant', content: null, tool_calls: [call] },
      finish: 'tool_calls',
    };
  }
  return {
    message: { role: 'assistant', content: 'text' in turn ? turn.text : '' },
    finish: 'stop',
  };
}

function openAiResponse(turn: VendorTurn, stream: boolean): Response {
  const { message, finish } = openAiMessage(turn);
  const base = { id: 'chatcmpl-1', created: 1, model: 'gpt-6.1-sol' };
  if (!stream) {
    return Response.json({
      ...base,
      object: 'chat.completion',
      choices: [{ index: 0, message, finish_reason: finish }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }
  const delta = message.tool_calls
    ? {
        role: 'assistant',
        tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })),
      }
    : { role: 'assistant', content: message.content };
  return sse(
    [
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
      },
    ],
    true,
  );
}

/** Responses API 출력 항목 (PRAMI-003 — 직접 OpenAI 는 /v1/responses). 추론 항목은 암호화 내용만(store:false 방식) */
type ResponsesItem = { type: string; id: string; [field: string]: unknown };

function responsesOutput(turn: VendorTurn): ResponsesItem[] {
  const reasoning = {
    type: 'reasoning',
    id: 'rs_1',
    summary: [],
    encrypted_content: 'enc-reasoning-1',
  };
  if ('toolCall' in turn) {
    const call = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: turn.toolCall.name,
      arguments: JSON.stringify(turn.toolCall.args),
      status: 'completed',
    };
    return [reasoning, call];
  }
  const message = (status: string, content: Record<string, unknown>[]) => ({
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status,
    content,
  });
  if ('refusal' in turn) {
    return [reasoning, message('completed', [{ type: 'refusal', refusal: turn.refusal }])];
  }
  if ('incomplete' in turn) {
    const { text, toolCall } = turn.incomplete;
    const items: ResponsesItem[] = [reasoning];
    if (text) items.push(message('incomplete', [{ type: 'output_text', text, annotations: [] }]));
    if (toolCall) {
      items.push({
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.args),
        status: 'incomplete',
      });
    }
    return items;
  }
  const text = 'text' in turn ? turn.text : '';
  return [reasoning, message('completed', [{ type: 'output_text', text, annotations: [] }])];
}

/** phase 'created' = 스트림 첫 이벤트(출력 없음), 'final' = 완료·미완료 본문 */
function responsesBody(turn: VendorTurn, phase: 'created' | 'final' = 'final') {
  const incomplete = 'incomplete' in turn ? turn.incomplete : null;
  const status = phase === 'created' ? 'in_progress' : incomplete ? 'incomplete' : 'completed';
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status,
    ...(incomplete && phase === 'final'
      ? { incomplete_details: { reason: incomplete.reason } }
      : { incomplete_details: null }),
    model: 'gpt-6.1-sol',
    output: phase === 'final' ? responsesOutput(turn) : [],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

/** 메시지 항목의 콘텐츠 부분 하나 → part.added · delta · done 이벤트 (output_text / refusal) */
function contentPartEvents(item: ResponsesItem, outputIndex: number): Record<string, unknown>[] {
  const part = (item.content as Record<string, string>[])[0];
  if (!part) return [];
  const at = { item_id: item.id, output_index: outputIndex, content_index: 0 };
  if (part.type === 'refusal') {
    return [
      { type: 'response.content_part.added', ...at, part: { type: 'refusal', refusal: '' } },
      { type: 'response.refusal.delta', ...at, delta: part.refusal },
      { type: 'response.refusal.done', ...at, refusal: part.refusal },
    ];
  }
  return [
    {
      type: 'response.content_part.added',
      ...at,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    { type: 'response.output_text.delta', ...at, delta: part.text },
    { type: 'response.output_text.done', ...at, text: part.text },
  ];
}

/** Responses 스트리밍 이벤트 (`event:` + `data:`) — 항목 추가 → 델타 → 항목 완료 → response.completed */
function responsesStream(turn: VendorTurn): Response {
  const events: Record<string, unknown>[] = [
    { type: 'response.created', response: responsesBody(turn, 'created') },
  ];
  responsesOutput(turn).forEach((item, outputIndex) => {
    const started =
      item.type === 'message'
        ? { ...item, content: [] }
        : item.type === 'function_call'
          ? { ...item, arguments: '' }
          : item;
    events.push({ type: 'response.output_item.added', output_index: outputIndex, item: started });
    if (item.type === 'message') events.push(...contentPartEvents(item, outputIndex));
    if (item.type === 'function_call') {
      events.push({
        type: 'response.function_call_arguments.delta',
        item_id: item.id,
        output_index: outputIndex,
        delta: item.arguments,
      });
      events.push({
        type: 'response.function_call_arguments.done',
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments,
      });
    }
    events.push({ type: 'response.output_item.done', output_index: outputIndex, item });
  });
  const final = responsesBody(turn);
  events.push({
    type: final.status === 'incomplete' ? 'response.incomplete' : 'response.completed',
    response: final,
  });
  const body = events
    .map(
      (event, index) => `event: ${String(event.type)}
data: ${JSON.stringify({ ...event, sequence_number: index })}

`,
    )
    .join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function openAiReply(url: string, turn: VendorTurn, stream: boolean): Response {
  if (url.endsWith('/responses')) {
    return stream ? responsesStream(turn) : Response.json(responsesBody(turn));
  }
  return openAiResponse(turn, stream);
}

export function createOpenAIStub(turns: VendorTurn[]): Stub {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = capture(requests, String(url), init);
    const turn = turns[Math.min(index, turns.length - 1)]!;
    index += 1;
    if ('hang' in turn) return hang(init);
    if ('error' in turn)
      return Response.json(turn.error.body, {
        status: turn.error.status,
        headers: turn.error.headers,
      });
    return openAiReply(String(url), turn, body.stream === true);
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

/**
 * Gemini 출력 상한 도달 (PRAMI-003 L-a, AC-370): 실 스트리밍처럼 텍스트 청크(finishReason 없음) 뒤 마지막 청크에
 * `finishReason: 'MAX_TOKENS'`. 비스트리밍은 한 응답에 둘 다. `incomplete.reason` 이 max_output_tokens 일 때만 쓴다.
 */
function geminiTruncated(text: string) {
  const usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
  const candidate = (parts: unknown[], finishReason?: string) => ({
    candidates: [
      { content: { role: 'model', parts }, index: 0, ...(finishReason ? { finishReason } : {}) },
    ],
    usageMetadata,
  });
  return {
    whole: candidate([{ text }], 'MAX_TOKENS'),
    chunks: [candidate([{ text }]), candidate([{ text: '' }], 'MAX_TOKENS')],
  };
}

function geminiCandidate(turn: VendorTurn) {
  const parts =
    'toolCall' in turn
      ? [
          // Gemini 3 는 함수 호출 부분에 thoughtSignature 를 붙이고, 다음 요청에 그대로 돌려받아야 한다(없으면 400)
          {
            functionCall: { name: turn.toolCall.name, args: turn.toolCall.args },
            thoughtSignature: 'sig-gemini-fixture-1',
          },
        ]
      : [{ text: 'text' in turn ? turn.text : '' }];
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
}

/** Gemini SDK 는 fetch 주입이 없어 전역 fetch 로 끼운다 (테스트에서 vi.stubGlobal) */
export function createGeminiStub(turns: VendorTurn[]): Stub {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    capture(requests, String(url), init);
    const turn = turns[Math.min(index, turns.length - 1)]!;
    index += 1;
    if ('hang' in turn) return hang(init);
    if ('error' in turn)
      return Response.json(turn.error.body, {
        status: turn.error.status,
        headers: turn.error.headers,
      });
    const streaming = String(url).includes('streamGenerateContent');
    if ('incomplete' in turn && turn.incomplete.reason === 'max_output_tokens') {
      const truncated = geminiTruncated(turn.incomplete.text ?? '');
      return streaming ? sse(truncated.chunks) : Response.json(truncated.whole);
    }
    const payload = geminiCandidate(turn);
    return streaming ? sse([payload]) : Response.json(payload);
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}
