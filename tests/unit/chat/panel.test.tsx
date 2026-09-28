import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatProvider } from '@/features/chat/ChatContext';
import { ChatDock, ChatLauncher } from '@/features/chat/ChatDock';
import { EXAMPLE_QUESTIONS, GREETING } from '@/features/chat/ChatPanel';
import type { ChatReplyView } from '@/features/chat/types';

/**
 * 챗봇 패널 UI (§4.5.9 디자인): 헤더/플로팅 버튼으로 열고 닫기, 인사·예시 칩, 질문 → 말풍선, 제품 퀵칩·후보 칩·견적 링크,
 * 오류 응답은 빨간 말풍선. fetch 는 모킹 — 서버 형태(ChatReplyView)만 따른다.
 */
const fetchMock = vi.fn();

function reply(partial: Partial<ChatReplyView> = {}): ChatReplyView {
  return {
    intent: 'help',
    reply: '아직 학습 중인 질문이에요.',
    candidates: [],
    showProductChips: false,
    action: null,
    ...partial,
  };
}

function respondWith(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

function renderDock() {
  return render(
    <ChatProvider>
      <ChatLauncher />
      <ChatDock />
    </ChatProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('ChatPanel', () => {
  it('헤더 버튼으로 열면 인사말·예시 칩, 닫기 버튼으로 닫힌다; 플로팅 버튼도 연다', async () => {
    renderDock();
    expect(screen.queryByRole('complementary', { name: '가격정책 챗봇' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '챗봇 열기' }));
    const panel = screen.getByRole('complementary', { name: '가격정책 챗봇' });
    expect(panel).toHaveTextContent('원가 데이터는 표시되지 않습니다');
    expect(within(panel).getByRole('log', { name: '대화' })).toHaveTextContent(GREETING);
    const examples = within(panel).getByRole('group', { name: '예시 질문' });
    for (const question of EXAMPLE_QUESTIONS) {
      expect(within(examples).getByRole('button', { name: question })).toBeInTheDocument();
    }
    await userEvent.click(within(panel).getByRole('button', { name: '챗봇 닫기' }));
    expect(screen.queryByRole('complementary', { name: '가격정책 챗봇' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '챗봇' }));
    expect(screen.getByRole('complementary', { name: '가격정책 챗봇' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '챗봇' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('질문을 보내면 POST /api/chat 로 보내고 답 말풍선·견적 링크·후보 칩·제품 칩을 보여 준다', async () => {
    renderDock();
    await userEvent.click(screen.getByRole('button', { name: '챗봇' }));
    const panel = screen.getByRole('complementary', { name: '가격정책 챗봇' });
    respondWith({
      ok: true,
      data: reply({
        intent: 'price',
        reply: '2026년 기준 WAPPLES Wapples-500 (H500 T2)의 가격은 12,000,000원입니다.',
        action: {
          type: 'calculator',
          href: '/calculator?family=WAPPLES&item=P10100015',
          label: '이 품목으로 견적 시작',
        },
      }),
    });
    await userEvent.type(within(panel).getByLabelText('질문 입력'), 'Wapples-500 가격 알려줘');
    await userEvent.click(within(panel).getByRole('button', { name: '보내기' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Wapples-500 가격 알려줘' }),
      }),
    );
    const log = within(panel).getByRole('log', { name: '대화' });
    expect(await within(log).findByText('12,000,000원', { exact: false })).toBeInTheDocument();
    expect(within(log).getByRole('link', { name: /이 품목으로 견적 시작/ })).toHaveAttribute(
      'href',
      '/calculator?family=WAPPLES&item=P10100015',
    );
    // 예시 칩은 첫 질문 뒤 사라진다
    expect(within(panel).queryByRole('group', { name: '예시 질문' })).not.toBeInTheDocument();

    // 모호한 답 → 후보 칩, 클릭하면 품번으로 다시 질문
    respondWith({
      ok: true,
      data: reply({
        intent: 'price',
        reply: '여러 품목이 검색되었습니다.',
        candidates: [
          { itemCode: 'P1', itemName: 'Wapples-2200 (H2200 T1)-1G', productFamily: 'WAPPLES' },
          { itemCode: 'P2', itemName: 'Wapples-2200 (H2200 T1)-1G RAID', productFamily: 'WAPPLES' },
        ],
      }),
    });
    await userEvent.type(within(panel).getByLabelText('질문 입력'), 'Wapples-2200 가격{enter}');
    const candidates = await within(panel).findByRole('group', { name: '후보 품목' });
    respondWith({
      ok: true,
      data: reply({ intent: 'price', reply: '가격은 21,000,000원입니다.' }),
    });
    await userEvent.click(within(candidates).getByRole('button', { name: /RAID \(P2\)$/ }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({ body: JSON.stringify({ message: 'P2' }) }),
    );
    expect(await within(log).findByText('가격은 21,000,000원입니다.')).toBeInTheDocument();

    // 견적 → 제품 퀵칩, 클릭하면 "<제품군> 견적"
    respondWith({
      ok: true,
      data: reply({
        intent: 'quote',
        reply: '어떤 제품의 견적을 도와드릴까요?',
        showProductChips: true,
      }),
    });
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '견적 뽑아줘{enter}');
    const products = await within(panel).findByRole('group', { name: '제품 선택' });
    respondWith({
      ok: true,
      data: reply({ intent: 'quote', reply: 'WAPPLES 견적을 시작합니다.' }),
    });
    await userEvent.click(within(products).getByRole('button', { name: 'WAPPLES' }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({ body: JSON.stringify({ message: 'WAPPLES 견적' }) }),
    );
    expect(await within(log).findByText('WAPPLES 견적을 시작합니다.')).toBeInTheDocument();
  });

  it('서버 오류 봉투(429 등)는 빨간 말풍선으로, 빈 입력은 보내지 않는다', async () => {
    renderDock();
    await userEvent.click(screen.getByRole('button', { name: '챗봇' }));
    const panel = screen.getByRole('complementary', { name: '가격정책 챗봇' });
    expect(within(panel).getByRole('button', { name: '보내기' })).toBeDisabled();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '   {enter}');
    expect(fetchMock).not.toHaveBeenCalled();
    respondWith(
      {
        ok: false,
        error: { code: 'RATE_LIMITED', message: '요청이 너무 잦습니다. 12초 후 다시 시도하세요' },
      },
      429,
    );
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '가격{enter}');
    const bubble = await within(panel).findByText(/요청이 너무 잦습니다/);
    expect(bubble.closest('[data-from="bot"]')).toHaveClass('text-red-500');
  });
});
