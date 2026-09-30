import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { takeSseEvents } from '@/features/chat/chatStream';
import { ChatProvider } from '@/features/chat/ChatContext';
import { ChatDock, ChatLauncher } from '@/features/chat/ChatDock';

/**
 * 패널 SSE 점진 렌더·중단 (PRAMI-002 §4.3.9, AC-243): LLM 연결 상태면 `Accept: text/event-stream` 으로 받아
 * token 을 이어 그리고, status 라벨을 보이고, final 로 교체한다(가드 교체본이 최종 표시). 패널을 닫으면 요청 signal 이 abort 된다.
 */
const fetchMock = vi.fn();
const encoder = new TextEncoder();

function sseBody(chunks: string[], gate?: Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      for (const [index, chunk] of chunks.entries()) {
        if (index === chunks.length - 1 && gate) await gate;
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const READY = {
  ok: true,
  data: { llm: { status: 'ready', vendor: 'anthropic', model: 'm' }, ruleFallback: true },
};

function final(reply: string) {
  return {
    intent: 'price',
    reply,
    candidates: [],
    showProductChips: false,
    action: null,
    mode: 'llm',
    llm: READY.data.llm,
  };
}

async function openPanel() {
  render(
    <ChatProvider statusEndpoint="/api/chat/status">
      <ChatLauncher />
      <ChatDock />
    </ChatProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: '챗봇 열기' }));
  const panel = screen.getByRole('complementary', { name: '가격정책 챗봇' });
  await within(panel).findByRole('note', { name: '과금 안내' });
  return panel;
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('takeSseEvents', () => {
  it('완성된 블록만 꺼내고 나머지는 버퍼로 남긴다 (청크 경계가 이벤트 중간이어도)', () => {
    const first = takeSseEvents(`${sse('token', { text: 'A' })}event: tok`);
    expect(first.events).toEqual([{ event: 'token', data: { text: 'A' } }]);
    const second = takeSseEvents(`${first.rest}en\ndata: {"text":"B"}\n\n`);
    expect(second.events).toEqual([{ event: 'token', data: { text: 'B' } }]);
    expect(second.rest).toBe('');
  });
});

describe('패널 스트리밍', () => {
  it('Accept 헤더로 요청 → status 라벨·토큰 점진 표시 → final(정본)로 교체', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/chat/status') return { ok: true, json: async () => READY };
      expect(new Headers(init?.headers).get('accept')).toBe('text/event-stream');
      return new Response(
        sseBody(
          [
            sse('status', { label: '가격 조회 중' }),
            sse('token', { text: '두 모델이 ' }) + sse('token', { text: '있습니다.' }),
            sse('final', final('Wapples-500 은 두 모델이 있습니다 (정본).')) + sse('done', {}),
          ],
          gate,
        ),
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
      );
    });
    const panel = await openPanel();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '가격{enter}');
    const log = within(panel).getByRole('log', { name: '대화' });
    expect(await within(log).findByText('두 모델이 있습니다.')).toBeInTheDocument();
    await act(async () => release());
    expect(
      await within(log).findByText('Wapples-500 은 두 모델이 있습니다 (정본).'),
    ).toBeInTheDocument();
    expect(within(log).queryByText('두 모델이 있습니다.')).not.toBeInTheDocument();
    expect(within(panel).queryByText('가격 조회 중')).not.toBeInTheDocument();
  });

  it('discard 계약 (QA L-1, Main 결정 A): 받는 즉시 부분 출력을 비우고 final 로 교체, 다음 턴 history 에 남지 않음', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/chat/status') return { ok: true, json: async () => READY };
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      call += 1;
      const chunks =
        call === 1
          ? [
              sse('token', { text: '부분 출력 문장입니다.' }),
              sse('discard', { reason: 'refusal' }),
              sse('final', { ...final('이 요청은 처리할 수 없습니다.'), mode: 'refusal' }) +
                sse('done', {}),
            ]
          : [sse('final', final('다음 답입니다.')) + sse('done', {})];
      return new Response(sseBody(chunks, call === 1 ? gate : undefined), {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    });
    const panel = await openPanel();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '가격{enter}');
    const log = within(panel).getByRole('log', { name: '대화' });
    // final 전(게이트 대기 중)에도 discard 로 부분 출력이 사라진다
    await vi.waitFor(() => expect(within(log).queryByText(/부분 출력/)).not.toBeInTheDocument());
    await act(async () => release());
    expect(await within(log).findByText('이 요청은 처리할 수 없습니다.')).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '다시{enter}');
    await within(log).findByText('다음 답입니다.');
    expect(JSON.stringify(bodies[1])).not.toContain('부분 출력');
  });

  it('패널을 닫으면 진행 중 요청 signal 이 abort 된다', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/chat/status') return { ok: true, json: async () => READY };
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    });
    const panel = await openPanel();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '가격{enter}');
    await vi.waitFor(() => expect(signal).toBeDefined());
    await userEvent.click(within(panel).getByRole('button', { name: '챗봇 닫기' }));
    expect(signal!.aborted).toBe(true);
  });
});
