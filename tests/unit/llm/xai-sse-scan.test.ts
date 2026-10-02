// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { scanSse, XaiServerToolUsedError } from '@/server/llm/vendors/xai-chat';

/** PR #22 QA I-18: xAI SSE 사후 검사가 여러 줄 `data:` 이벤트도 해석한다 (SSE 규격 — 줄을 \n 으로 이어 붙임) */
const SERVER_TOOL = { type: 'response.output_item.added', item: { type: 'web_search_call' } };
const TEXT_DELTA = { type: 'response.output_text.delta', delta: '안녕하세요' };

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function consume(body: ReadableStream<Uint8Array>) {
  const onDetect = vi.fn();
  const out = scanSse(body, onDetect);
  try {
    const text = await new Response(out).text();
    return { onDetect, text, error: null as unknown };
  } catch (error) {
    return { onDetect, text: '', error };
  }
}

/** JSON 을 여러 줄로 쪼갠 data 줄들 (`data: {` / `data: "type": …` …) */
const multiLine = (value: unknown) =>
  JSON.stringify(value, null, 1)
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n');

describe('scanSse', () => {
  it('한 줄 data — 서버측 도구 이벤트면 즉시 끊는다 (기존 동작)', async () => {
    const result = await consume(streamOf(`data: ${JSON.stringify(SERVER_TOOL)}\n\n`));
    expect(result.error).toBeInstanceOf(XaiServerToolUsedError);
    expect(result.onDetect).toHaveBeenCalledTimes(1);
  });

  it('여러 줄 data 로 나뉜 서버측 도구 이벤트도 감지한다 (I-18)', async () => {
    const result = await consume(
      streamOf(`event: response.output_item.added\n${multiLine(SERVER_TOOL)}\n\n`),
    );
    expect(result.error).toBeInstanceOf(XaiServerToolUsedError);
  });

  it('CRLF·청크 경계에 걸친 여러 줄 이벤트, 끝 빈 줄 없이 스트림이 끝나도 감지', async () => {
    const event = multiLine(SERVER_TOOL).replaceAll('\n', '\r\n');
    const mid = Math.floor(event.length / 2);
    const result = await consume(streamOf(event.slice(0, mid), event.slice(mid)));
    expect(result.error).toBeInstanceOf(XaiServerToolUsedError);
  });

  it('일반 텍스트 이벤트(한 줄·여러 줄)·[DONE]·주석은 그대로 통과', async () => {
    const raw = `: keep-alive\n\ndata: ${JSON.stringify(TEXT_DELTA)}\n\n${multiLine(TEXT_DELTA)}\n\ndata: [DONE]\n\n`;
    const result = await consume(streamOf(raw));
    expect(result.error).toBeNull();
    expect(result.onDetect).not.toHaveBeenCalled();
    expect(result.text).toBe(raw);
  });

  it('파싱할 수 없는 data 는 통과 (2차 검사 — fail-open 은 1차 요청 가드가 보완)', async () => {
    const result = await consume(streamOf('data: {"broken": \ndata: nope\n\n'));
    expect(result.error).toBeNull();
  });
});
