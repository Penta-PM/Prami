import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatProvider } from '@/features/chat/ChatContext';
import { ChatDock, ChatLauncher } from '@/features/chat/ChatDock';
import type { ChatReplyView, ChatStatusView } from '@/features/chat/types';

/**
 * 챗봇 패널 LLM 안내 (PRAMI-002 §4.9·§4.8.2·§4.3.7·§4.3.10): 상태 조회 배너·설정 링크·첫 봇 안내(1회)·과금 고지,
 * LLM 연결 시에만 히스토리 전송, LLM 텍스트의 URL 은 링크가 아니다(AC-227 ④), Web Storage 미사용(AC-230 ④).
 */
const fetchMock = vi.fn();
const MISSING = 'LLM API 키가 등록되지 않았습니다. 사용자 설정에서 등록하세요.';

function status(llmStatus: string, withSetup = false): ChatStatusView {
  return {
    llm: { status: llmStatus, vendor: llmStatus === 'ready' ? 'anthropic' : null, model: null },
    ruleFallback: true,
    ...(withSetup ? { setup: { status: llmStatus, message: MISSING, href: '/settings#llm' } } : {}),
  };
}

function reply(partial: Partial<ChatReplyView>): ChatReplyView {
  return {
    intent: 'price',
    reply: '답변',
    candidates: [],
    showProductChips: false,
    action: null,
    ...partial,
  };
}

function route(statusBody: ChatStatusView, replies: ChatReplyView[]) {
  const queue = [...replies];
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url === '/api/chat/status'
        ? { ok: true, data: statusBody }
        : { ok: true, data: queue.shift() },
  }));
}

async function openPanel() {
  render(
    <ChatProvider statusEndpoint="/api/chat/status">
      <ChatLauncher />
      <ChatDock />
    </ChatProvider>,
  );
  // 진입점은 헤더 챗봇 버튼 하나 (#30 — 우하단 플로팅 버튼 제거)
  await userEvent.click(screen.getByRole('button', { name: '챗봇' }));
  return screen.getByRole('complementary', { name: '가격정책 챗봇' });
}

const chatBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/api/chat')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('미등록 안내 (AC-222)', () => {
  it('열면 상태 조회 → 배너·설정 링크, 첫 봇 메시지 안내; 같은 안내가 반복되면 짧은 notice 한 줄; 히스토리 미전송', async () => {
    route(status('missing', true), [
      reply({
        reply: '규칙 답 1',
        mode: 'rule',
        setup: { status: 'missing', message: MISSING, href: '/settings#llm' },
      }),
      reply({
        reply: '규칙 답 2',
        mode: 'rule',
        setup: { status: 'missing', message: MISSING, href: '/settings#llm' },
      }),
    ]);
    const panel = await openPanel();
    const banner = await within(panel).findByRole('status', { name: 'LLM 연결 안내' });
    expect(banner).toHaveTextContent(MISSING);
    expect(within(banner).getByRole('link', { name: /사용자 설정에서 등록하기/ })).toHaveAttribute(
      'href',
      '/settings#llm',
    );
    const log = within(panel).getByRole('log', { name: '대화' });
    // 첫 봇 메시지(인사말)에 안내 + 설정 링크가 붙는다 (말풍선을 새로 만들지 않음)
    const greeting = log.querySelectorAll('[data-from="bot"]')[0]!;
    await within(greeting as HTMLElement).findByText(MISSING);
    expect(
      within(greeting as HTMLElement).getByRole('link', { name: /사용자 설정에서 등록하기/ }),
    ).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), 'Wapples-500 가격{enter}');
    expect(await within(log).findByText('규칙 답 1')).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '또 질문{enter}');
    expect(await within(log).findByText('규칙 답 2')).toBeInTheDocument();
    expect(within(log).getAllByText(MISSING)).toHaveLength(1);
    expect(within(log).getAllByText('LLM 미연결 — 기본 응답').length).toBeGreaterThanOrEqual(1);
    expect(chatBodies().every((body) => !('history' in body))).toBe(true);
  });
});

describe('LLM 연결 (AC-230 ①·§4.8.2)', () => {
  it('ready: 과금 고지(닫으면 숨김), 두 번째 질문부터 최근 대화를 텍스트로 전송', async () => {
    route(status('ready'), [
      reply({ reply: '첫 답', mode: 'llm' }),
      reply({ reply: '둘째 답', mode: 'llm' }),
    ]);
    const panel = await openPanel();
    const billing = await within(panel).findByRole('note', { name: '과금 안내' });
    expect(billing).toHaveTextContent('본인 벤더 계정');
    await userEvent.click(within(panel).getByRole('button', { name: '과금 안내 닫기' }));
    expect(within(panel).queryByRole('note', { name: '과금 안내' })).not.toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '첫 질문{enter}');
    await within(panel).findByText('첫 답');
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '둘째 질문{enter}');
    await within(panel).findByText('둘째 답');
    const [first, second] = chatBodies();
    expect(first).toEqual({ message: '첫 질문' });
    expect(second).toEqual({
      message: '둘째 질문',
      history: [
        { role: 'user', text: '첫 질문' },
        { role: 'assistant', text: '첫 답' },
      ],
    });
  });

  it('r4 §4.3.11: 원가 거부 응답의 기본값 llm(missing)으로 배너·상태를 바꾸지 않는다', async () => {
    route(status('ready'), [
      reply({
        intent: 'cost',
        reply: '원가 정보는 관리자만 조회할 수 있습니다.',
        mode: 'refusal',
        llm: { status: 'missing', vendor: null, model: null },
      }),
      reply({ reply: '다음 답', mode: 'llm' }),
    ]);
    const panel = await openPanel();
    await within(panel).findByRole('note', { name: '과금 안내' });
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '원가 알려줘{enter}');
    await within(panel).findByText('원가 정보는 관리자만 조회할 수 있습니다.');
    expect(within(panel).queryByRole('status', { name: 'LLM 연결 안내' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('note', { name: '과금 안내' })).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '가격{enter}');
    await within(panel).findByText('다음 답');
    // 여전히 ready 로 보고 대화 히스토리를 보낸다
    expect(chatBodies()[1]).toHaveProperty('history');
  });

  it('AC-227 ④: LLM 텍스트 속 외부 URL 은 링크(<a>)로 렌더링하지 않는다 — 링크는 action.href 뿐', async () => {
    route(status('ready'), [
      reply({
        reply: '자세한 건 https://evil.example/steal 를 보세요',
        mode: 'llm',
        action: { type: 'calculator', href: '/calculator?family=WAPPLES', label: '견적 시작' },
      }),
    ]);
    const panel = await openPanel();
    await userEvent.type(within(panel).getByLabelText('질문 입력'), '질문{enter}');
    const log = within(panel).getByRole('log', { name: '대화' });
    await within(log).findByText(/evil\.example/);
    const hrefs = within(log)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/calculator?family=WAPPLES']);
    expect(log.innerHTML).not.toMatch(/href="https?:\/\/evil/);
  });
});

describe('대화 미저장 (AC-230 ④)', () => {
  it('패널 코드(src/features/chat)에 sessionStorage/localStorage 사용이 없다', () => {
    const dir = path.join(process.cwd(), 'src/features/chat');
    for (const name of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, name), 'utf8')).not.toMatch(/sessionStorage|localStorage/);
    }
  });
});
