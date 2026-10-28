import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';

import {
  conversation,
  createFakeServer,
  gate,
  json,
  LLM_READY,
  reply,
  sse,
  sseResponse,
  statusView,
} from '../../helpers/chat-page';

vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);

const { navigation } = await import('../../helpers/next-navigation');
const { ChatWorkspace } = await import('@/features/chat/ChatWorkspace');

/**
 * 챗 메시지 버블 진입 (Motion 도입 스펙 §3.3 챗 메시지 — UX PR-C2 챗봇 화면으로 이전): DB 에서 읽어 그린 기존 버블은
 * 애니메이션 없이 최종 상태, 이후 추가된 버블만 1회 fadeUp(y 8px). 스트리밍으로 글자가 늘어도 같은 DOM 노드가 유지되고
 * 다시 진입하지 않으며 `layout` 투영 transform 이 붙지 않는다. 진입 여부는 실제 애니메이션으로 본다 — 이 describe 에서만 skipAnimations 를 끈다.
 */
const fetchMock = vi.fn();
const withMotion = { wrapper: MotionProvider };
const PATH = '/pricing/chat';

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

const STORED = conversation({
  messages: [
    {
      id: 1,
      role: 'user',
      content: '저장된 질문',
      action: null,
      createdAt: '2026-10-27T01:00:00.000Z',
    },
    {
      id: 2,
      role: 'assistant',
      content: '저장된 답',
      action: null,
      createdAt: '2026-10-27T01:00:01.000Z',
    },
  ],
});

async function openConversation() {
  navigation.reset(PATH, `c=${STORED.id}`);
  render(<ChatWorkspace domain="pricing" />, withMotion);
  const log = screen.getByRole('log', { name: '대화' });
  await within(log).findByText('저장된 답');
  return log;
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

  it('① DB 에서 복원한 기존 버블에는 숨김 스타일이 없다', async () => {
    createFakeServer(fetchMock, { conversations: [{ ...STORED }] });
    const log = await openConversation();
    expect(isHidden(bubbleRoot('저장된 질문', log))).toBe(false);
    expect(isHidden(bubbleRoot('저장된 답', log))).toBe(false);
  });

  it('② 새 메시지가 추가되면 그 버블만 fadeUp(8px) 으로 진입하고, 기존 버블은 그대로다', async () => {
    createFakeServer(fetchMock, {
      conversations: [{ ...STORED }],
      chat: () => json({ ok: true, data: reply({ intent: 'help', reply: '규칙 답입니다.' }) }),
    });
    const log = await openConversation();
    const stored = bubbleRoot('저장된 답', log);
    await userEvent.type(screen.getByLabelText('질문 입력'), '질문{enter}');
    await within(log).findByText('규칙 답입니다.');
    const userBubble = bubbleRoot('질문', log);
    const answerBubble = bubbleRoot('규칙 답입니다.', log);
    expect(isHidden(answerBubble)).toBe(true);
    expect(isHidden(stored)).toBe(false);
    expect(bubbleRoot('저장된 답', log)).toBe(stored);
    await waitFor(() => {
      expect(isHidden(answerBubble)).toBe(false);
      expect(isHidden(userBubble)).toBe(false);
    });
  });

  it('③ 스트리밍으로 텍스트가 늘어도 같은 버블 노드가 유지되고 다시 진입하거나 layout transform 이 붙지 않는다', async () => {
    const gates = [gate(), gate(), gate()];
    createFakeServer(fetchMock, {
      status: statusView('ready'),
      conversations: [{ ...STORED }],
      chat: ({ signal }) =>
        sseResponse(
          [
            sse('token', { text: '첫 토큰' }),
            sse('token', { text: ' 이어지는 토큰' }),
            sse(
              'final',
              reply({ reply: '첫 토큰 이어지는 토큰 (정본)', mode: 'llm', llm: LLM_READY }),
            ) + sse('done', {}),
          ],
          { gates: gates.map((g) => g.promise), signal },
        ),
    });
    const log = await openConversation();
    await screen.findByRole('note', { name: '과금 안내' });
    await userEvent.type(screen.getByLabelText('질문 입력'), '가격{enter}');

    await act(async () => gates[0]!.release());
    await within(log).findByText('첫 토큰');
    const node = bubbleRoot('첫 토큰', log);
    await waitFor(() => expect(isHidden(node)).toBe(false));

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
