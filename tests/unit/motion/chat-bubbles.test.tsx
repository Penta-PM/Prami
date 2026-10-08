import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { ChatProvider } from '@/features/chat/ChatContext';
import { ChatDock, ChatLauncher } from '@/features/chat/ChatDock';
import { GREETING } from '@/features/chat/ChatPanel';

/**
 * 챗 메시지 버블 진입 (Motion 도입 스펙 §3.3 챗 메시지, §6 PR-4): 패널을 열 때 이미 있던 버블은 애니메이션 없이 최종 상태,
 * 열린 뒤 추가된 버블만 1회 fadeUp(y 8px). 스트리밍으로 글자가 늘어도 같은 DOM 노드가 유지되고 다시 진입하지 않으며
 * `layout` 투영 transform 이 붙지 않는다. 진입 여부는 실제 애니메이션으로 본다 — 이 describe 에서만 skipAnimations 를 끈다.
 */
const fetchMock = vi.fn();
const encoder = new TextEncoder();
const withMotion = { wrapper: MotionProvider };

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const LLM = { status: 'ready', vendor: 'anthropic', model: 'm' };
const READY = { ok: true, data: { llm: LLM, ruleFallback: true } };

/** chunk 마다 gate 를 하나씩 기다렸다 보낸다 — 토큰 사이에서 DOM 을 관찰하려고 */
function gatedSse(chunks: string[], gates: Promise<void>[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      for (const [index, chunk] of chunks.entries()) {
        await gates[index];
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** 버블 루트(m.div) — 말풍선(data-from) 의 부모 */
function bubbleRoot(text: string | RegExp, log: HTMLElement): HTMLElement {
  const bubble = within(log).getByText(text).closest('[data-from]');
  if (!(bubble instanceof HTMLElement) || !bubble.parentElement)
    throw new Error('bubble not found');
  return bubble.parentElement;
}

function isHidden(element: HTMLElement) {
  const { opacity, transform } = element.style;
  return (opacity !== '' && Number(opacity) < 1) || (transform !== '' && transform !== 'none');
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openPanel() {
  render(
    <ChatProvider statusEndpoint="/api/chat/status">
      <ChatLauncher />
      <ChatDock />
    </ChatProvider>,
    withMotion,
  );
  // 진입점은 헤더 챗봇 버튼 하나 (#30 — 플로팅 버튼 제거, Motion 스펙 §9.5)
  await userEvent.click(screen.getByRole('button', { name: '챗봇' }));
  const panel = screen.getByRole('complementary', { name: '가격정책 챗봇' });
  return { panel, log: within(panel).getByRole('log', { name: '대화' }) };
}

describe('챗 버블 진입 — 실제 애니메이션 (skipAnimations 끔)', () => {
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    MotionGlobalConfig.skipAnimations = true;
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('① 패널 첫 렌더·재오픈 시 기존 버블(인사말)에는 숨김 스타일이 없다', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => READY });
    const { panel, log } = await openPanel();
    expect(isHidden(bubbleRoot(GREETING, log))).toBe(false);

    await userEvent.click(within(panel).getByRole('button', { name: '챗봇 닫기' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: '가격정책 챗봇' })).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: '챗봇' }));
    const reopened = screen.getByRole('complementary', { name: '가격정책 챗봇' });
    const reopenedLog = within(reopened).getByRole('log', { name: '대화' });
    expect(isHidden(bubbleRoot(GREETING, reopenedLog))).toBe(false);
  });

  it('② 새 메시지가 추가되면 그 버블만 fadeUp(8px) 으로 진입하고, 기존 버블은 그대로다', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/chat/status')
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: { llm: { status: 'missing', vendor: null, model: null }, ruleFallback: true },
          }),
        };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            intent: 'help',
            reply: '규칙 답입니다.',
            candidates: [],
            showProductChips: false,
            action: null,
          },
        }),
      };
    });
    const { panel, log } = await openPanel();
    await wait(320); // 패널 진입(240ms) 완료
    const greeting = bubbleRoot(GREETING, log);

    await userEvent.type(within(panel).getByLabelText('질문 입력'), '질문{enter}');
    const answer = await within(log).findByText('규칙 답입니다.');
    const userBubble = bubbleRoot('질문', log);
    const answerBubble = bubbleRoot('규칙 답입니다.', log);
    expect(answer).toBeInTheDocument();
    // 진입 직후: 새 버블은 아직 fade/translate 중, 기존 인사말은 최종 상태
    expect(isHidden(answerBubble)).toBe(true);
    expect(isHidden(greeting)).toBe(false);
    expect(bubbleRoot(GREETING, log)).toBe(greeting);

    // base(180ms) 뒤에는 최종 상태
    await waitFor(() => {
      expect(isHidden(answerBubble)).toBe(false);
      expect(isHidden(userBubble)).toBe(false);
    });
  });

  it('③ 스트리밍으로 텍스트가 늘어도 같은 버블 노드가 유지되고 다시 진입하거나 layout transform 이 붙지 않는다', async () => {
    const gates = [gate(), gate(), gate()];
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/chat/status') return { ok: true, json: async () => READY };
      return new Response(
        gatedSse(
          [
            sse('token', { text: '첫 토큰' }),
            sse('token', { text: ' 이어지는 토큰' }),
            sse('final', {
              intent: 'price',
              reply: '첫 토큰 이어지는 토큰 (정본)',
              candidates: [],
              showProductChips: false,
              action: null,
              mode: 'llm',
              llm: LLM,
            }) + sse('done', {}),
          ],
          gates.map((g) => g.promise),
        ),
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
      );
    });
    const { panel, log } = await openPanel();
    await within(panel).findByRole('note', { name: '과금 안내' });
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '가격{enter}');

    await act(async () => gates[0]!.release());
    await within(log).findByText('첫 토큰');
    const node = bubbleRoot('첫 토큰', log);
    await waitFor(() => expect(isHidden(node)).toBe(false)); // 첫 진입 완료

    await act(async () => gates[1]!.release());
    await within(log).findByText('첫 토큰 이어지는 토큰');
    expect(bubbleRoot('첫 토큰 이어지는 토큰', log)).toBe(node);
    expect(isHidden(node)).toBe(false);

    await act(async () => gates[2]!.release());
    await within(log).findByText('첫 토큰 이어지는 토큰 (정본)');
    expect(bubbleRoot('첫 토큰 이어지는 토큰 (정본)', log)).toBe(node);
    await wait(50);
    expect(isHidden(node)).toBe(false);
    expect(node.style.transform === '' || node.style.transform === 'none').toBe(true);
    // 말풍선 자체에도 transform·opacity 가 붙지 않는다 (layout 투영 없음)
    expect((node.firstElementChild as HTMLElement).getAttribute('style')).toBeNull();
  });
});
