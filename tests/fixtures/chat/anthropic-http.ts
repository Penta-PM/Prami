/**
 * Anthropic Messages API 전송 계층 스텁 (PRAMI-002 AC-231·AC-228). ChatAnthropic 의 `clientOptions.fetch` 로 끼워
 * **실제로 나가는 HTTP 요청의 URL·헤더·본문**을 기록하고, 스크립트한 응답(JSON)을 돌려준다. 실벤더로는 아무것도 나가지 않는다.
 */
export type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type AnthropicResponse = {
  content: Record<string, unknown>[];
  stop_reason: 'end_turn' | 'tool_use' | 'refusal';
};

export function thinkingBlock(text: string) {
  return { type: 'thinking', thinking: text, signature: `sig-${text.length}-EQ==` };
}

export function toolUseBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: 'tool_use', id, name, input };
}

export function createAnthropicStub(responses: AnthropicResponse[], model = 'claude-opus-5-5') {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      url: String(url),
      headers,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    if (requests.at(-1)!.body.stream === true) return sseResponse(response, model, index);
    return Response.json({
      id: `msg_${index}`,
      type: 'message',
      role: 'assistant',
      model,
      content: response.content,
      stop_reason: response.stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

type Block = Record<string, unknown>;

/** 블록 하나 → content_block_start/delta/stop 이벤트 (Messages API 스트리밍 형식) */
function blockEvents(block: Block, index: number): Block[] {
  const stop = { type: 'content_block_stop', index };
  if (block.type === 'thinking') {
    return [
      { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: block.thinking },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: block.signature },
      },
      stop,
    ];
  }
  if (block.type === 'tool_use') {
    return [
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      },
      stop,
    ];
  }
  return [
    { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
    stop,
  ];
}

/** stream:true 요청 (LangGraph streamMode 'messages' 가 모델을 스트리밍으로 부른다) */
function sseResponse(response: AnthropicResponse, model: string, index: number): Response {
  const events: Block[] = [
    {
      type: 'message_start',
      message: {
        id: `msg_${index}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    ...response.content.flatMap((block, position) => blockEvents(block, position)),
    {
      type: 'message_delta',
      delta: { stop_reason: response.stop_reason, stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  ];
  const body = events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
