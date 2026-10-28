import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  conversation,
  createFakeServer,
  gate,
  json,
  LLM_READY,
  MISSING_MESSAGE,
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
const { takeSseEvents } = await import('@/features/chat/chatStream');
const { CHAT_PAGE_COPY, PRICING_EXAMPLE_QUESTIONS, PROCUREMENT_EXAMPLE_QUESTIONS } =
  await import('@/features/chat/copy');

/**
 * 챗봇 화면 (UX PR-C2 §4.2): 대화 목록(스켈레톤·빈 상태·최근 순·상대 시각·aria-current), 새 대화(첫 질문 때 생성 → `?c=`),
 * 이름 바꾸기(Enter 저장·Esc 취소), 삭제(확인 모달·되돌릴 수 없음·포커스 이동), `?c=` 딥 링크 복원, 스트리밍 중지·다시 시도,
 * 조달 챗봇 준비 중 오류 표시, 좁은 화면 한 화면씩, LLM 안내 배너·과금 고지, 평문 렌더. fetch·라우터는 대역(합성 데이터).
 */
const fetchMock = vi.fn();
const PATH = '/pricing/chat';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  navigation.reset(PATH, '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderPage(domain: 'pricing' | 'procurement' = 'pricing') {
  return render(<ChatWorkspace domain={domain} />);
}

const listNav = () => screen.getByRole('navigation', { name: '대화 목록' });
const log = () => screen.getByRole('log', { name: '대화' });
const composer = () => screen.getByLabelText('질문 입력');
const bots = () => Array.from(log().querySelectorAll<HTMLElement>('[data-from="bot"]'));
const users = () => Array.from(log().querySelectorAll<HTMLElement>('[data-from="user"]'));

async function ask(text: string) {
  await userEvent.type(composer(), `${text}{enter}`);
}

describe('대화 목록', () => {
  it('불러오는 동안 스켈레톤(aria-busy) → 최근 순 제목·상대 시각, 제목 없는 대화는 "새 대화"', async () => {
    const listGate = gate();
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    createFakeServer(fetchMock, {
      listGate: listGate.promise,
      conversations: [
        conversation({ title: 'Wapples 가격 문의', updatedAt: recent }),
        conversation({ title: null, updatedAt: '2026-01-02T00:00:00.000Z' }),
      ],
    });
    renderPage();
    expect(listNav()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('conversation-list-skeleton')).toBeInTheDocument();
    expect(within(listNav()).getByRole('status')).toHaveTextContent('대화 목록을 불러오는 중');
    await act(async () => listGate.release());
    const links = await within(listNav()).findAllByRole('link');
    expect(links.map((link) => link.querySelector('span')?.textContent)).toEqual([
      'Wapples 가격 문의',
      '새 대화',
    ]);
    expect(links[0]).toHaveTextContent('5분 전');
    expect(links[1]).toHaveTextContent('2026-01-02');
    expect(links[0]!.querySelector('time')).toHaveAttribute(
      'title',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    );
    expect(listNav()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByTestId('conversation-list-skeleton')).not.toBeInTheDocument();
    // 목록 행은 밀집 컨테이너(sm)
    expect(listNav()).toHaveAttribute('data-density', 'sm');
  });

  it('목록 조회 실패 → 오류 안내 + 다시 시도', async () => {
    let fail = true;
    const server = createFakeServer(fetchMock);
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (fail && String(url).startsWith('/api/chat/conversations?'))
        return json({ ok: false, error: { code: 'INTERNAL', message: '오류' } }, 500);
      return base(url, init);
    });
    renderPage();
    const alert = await within(listNav()).findByRole('alert');
    expect(alert).toHaveTextContent('대화 목록을 불러오지 못했습니다');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await within(listNav()).findByText(/저장된 대화가 없습니다/)).toBeInTheDocument();
    // 실패 1회(대역 앞단) + 다시 시도 1회(가짜 서버 기록)
    expect(server.count('GET', /conversations\?domain=pricing/)).toBe(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/chat/conversations?')),
    ).toHaveLength(2);
  });

  it('빈 목록 → 빈 안내 + 대화창의 인사·예시 질문 칩, 칩으로 첫 질문 → 대화 생성·?c= 반영·목록에 자동 제목', async () => {
    const server = createFakeServer(fetchMock, {
      chat: () => json({ ok: true, data: reply({ reply: '12,000,000원입니다.' }) }),
    });
    renderPage();
    expect(await within(listNav()).findByText(/저장된 대화가 없습니다/)).toBeInTheDocument();
    expect(log()).toHaveTextContent(CHAT_PAGE_COPY.pricing.greeting);
    const examples = within(log()).getByRole('group', { name: '예시 질문' });
    for (const question of PRICING_EXAMPLE_QUESTIONS)
      expect(within(examples).getByRole('button', { name: question })).toBeInTheDocument();

    await userEvent.click(
      within(examples).getByRole('button', { name: PRICING_EXAMPLE_QUESTIONS[0] }),
    );
    expect(await within(log()).findByText('12,000,000원입니다.')).toBeInTheDocument();
    // 새 대화는 첫 질문 때 만든다 (POST) → URL 은 replace 로 ?c=
    expect(server.count('POST', /^\/api\/chat\/conversations$/)).toBe(1);
    const created = server.state.conversations[0]!;
    expect(navigation.replace).toHaveBeenCalledWith(`${PATH}?c=${created.id}`, { scroll: false });
    expect(navigation.search()).toBe(`c=${created.id}`);
    // history 없이 저장 대화로 보낸다 (서버가 DB 에서 history 를 읽음)
    expect(server.chatCalls[0]!.body).toEqual({
      message: PRICING_EXAMPLE_QUESTIONS[0],
      conversationId: created.id,
      domain: 'pricing',
    });
    // 목록을 다시 읽어 자동 제목(첫 질문 앞 30자)이 보이고 선택 행이 된다
    const row = await within(listNav()).findByRole('link', {
      name: new RegExp(PRICING_EXAMPLE_QUESTIONS[0]),
    });
    expect(row).toHaveAttribute('aria-current', 'page');
    // 예시 칩은 첫 질문 뒤 사라진다
    expect(within(log()).queryByRole('group', { name: '예시 질문' })).not.toBeInTheDocument();
    // 대화창 제목도 목록 제목을 따른다
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      PRICING_EXAMPLE_QUESTIONS[0],
    );
  });

  it('대화 생성 상한(409) → 오류 말풍선에 서버 문구, URL 은 그대로', async () => {
    createFakeServer(fetchMock, {
      failCreate: {
        status: 409,
        message: '대화는 200개까지 저장됩니다. 지난 대화를 삭제한 뒤 새 대화를 시작하세요',
      },
    });
    renderPage();
    await within(listNav()).findByText(/저장된 대화가 없습니다/);
    await ask('질문');
    expect(await within(log()).findByText(/200개까지 저장됩니다/)).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(bots().at(-1)).toHaveClass('text-text-danger');
  });
});

describe('?c= 딥 링크·선택·새 대화', () => {
  it('?c= 로 열면 DB 대화를 복원한다 — 말풍선마다 작성 시각, 액션 링크(같은 탭), 선택 행 aria-current', async () => {
    const target = conversation({
      title: '견적 대화',
      messages: [
        {
          id: 1,
          role: 'user',
          content: 'Wapples-500 견적',
          action: null,
          createdAt: '2026-10-27T01:00:00.000Z',
        },
        {
          id: 2,
          role: 'assistant',
          content: '견적 계산기에서 이어서 선택하세요.',
          action: {
            type: 'calculator',
            href: '/calculator?family=WAPPLES&item=P1',
            label: '계산기에서 열기',
          },
          createdAt: '2026-10-27T01:00:05.000Z',
        },
      ],
    });
    const other = conversation({ title: '다른 대화' });
    createFakeServer(fetchMock, { conversations: [target, other] });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    expect(
      await within(log()).findByText('견적 계산기에서 이어서 선택하세요.'),
    ).toBeInTheDocument();
    expect(users()[0]).toHaveTextContent('Wapples-500 견적');
    const times = Array.from(log().querySelectorAll('time')).map((time) => time.textContent);
    expect(times).toEqual(['2026-10-27 10:00', '2026-10-27 10:00']);
    expect(within(log()).getByRole('link', { name: /계산기에서 열기/ })).toHaveAttribute(
      'href',
      '/calculator?family=WAPPLES&item=P1',
    );
    expect(within(log()).getByRole('link', { name: /계산기에서 열기/ })).not.toHaveAttribute(
      'target',
    );
    expect(await within(listNav()).findByRole('link', { name: /견적 대화/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('견적 대화');

    // 다른 행을 누르면 push(?c=) → 그 대화를 읽는다
    await userEvent.click(within(listNav()).getByRole('link', { name: /다른 대화/ }));
    expect(navigation.push).toHaveBeenCalledWith(`${PATH}?c=${other.id}`, { scroll: false });
    await waitFor(() =>
      expect(within(listNav()).getByRole('link', { name: /다른 대화/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    await waitFor(() =>
      expect(within(log()).queryByText('Wapples-500 견적')).not.toBeInTheDocument(),
    );
    expect(within(log()).getByRole('group', { name: '예시 질문' })).toBeInTheDocument();
  });

  it('없는(또는 남의) 대화 id → "대화를 찾을 수 없습니다" 안내, 입력 비활성', async () => {
    createFakeServer(fetchMock, { conversations: [conversation()] });
    navigation.reset(PATH, 'c=00000000-0000-4000-8000-999999999999');
    renderPage();
    expect(await within(log()).findByRole('alert')).toHaveTextContent('대화를 찾을 수 없습니다');
    expect(composer()).toBeDisabled();
  });

  it('"새 대화" → ?c= 를 지우고(push) 빈 대화창·입력창 포커스, 대화는 아직 만들지 않는다', async () => {
    const target = conversation({
      messages: [
        {
          id: 1,
          role: 'user',
          content: '이전 질문',
          action: null,
          createdAt: '2026-10-27T01:00:00.000Z',
        },
      ],
    });
    const server = createFakeServer(fetchMock, { conversations: [target] });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await within(log()).findByText('이전 질문');
    await userEvent.click(screen.getByRole('button', { name: '새 대화' }));
    expect(navigation.push).toHaveBeenCalledWith(PATH, { scroll: false });
    await waitFor(() => expect(within(log()).queryByText('이전 질문')).not.toBeInTheDocument());
    expect(within(log()).getByRole('group', { name: '예시 질문' })).toBeInTheDocument();
    await waitFor(() => expect(composer()).toHaveFocus());
    expect(server.count('POST', /^\/api\/chat\/conversations$/)).toBe(0);
    expect(within(listNav()).getByRole('link', { name: /합성 대화/ })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

describe('이름 바꾸기 (⋯ 메뉴)', () => {
  it('⋯ 메뉴: 키보드로 열면 첫 항목 포커스, ↑↓ 이동, Esc 로 닫고 버튼으로 포커스', async () => {
    createFakeServer(fetchMock, { conversations: [conversation({ title: '메뉴 대화' })] });
    renderPage();
    const trigger = await screen.findByRole('button', { name: '메뉴 대화 메뉴' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: '메뉴 대화 메뉴' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['이름 바꾸기', '삭제']);
    await waitFor(() => expect(items[0]).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('제자리 입력: Esc 는 취소(요청 없음), Enter 는 저장(PATCH) → 목록·대화창 제목 갱신, 포커스는 그 행', async () => {
    const target = conversation({ title: '처음 이름' });
    const server = createFakeServer(fetchMock, { conversations: [target] });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '처음 이름 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '대화 이름' });
    expect(input).toHaveValue('처음 이름');
    expect(input).toHaveFocus();
    await userEvent.type(input, ' 바뀜');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: '대화 이름' })).not.toBeInTheDocument();
    expect(within(listNav()).getByRole('link', { name: /처음 이름/ })).toBeInTheDocument();
    expect(server.count('PATCH', /conversations\//)).toBe(0);
    await waitFor(() =>
      expect(within(listNav()).getByRole('link', { name: /처음 이름/ })).toHaveFocus(),
    );

    await userEvent.click(await screen.findByRole('button', { name: '처음 이름 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    const again = screen.getByRole('textbox', { name: '대화 이름' });
    await userEvent.clear(again);
    await userEvent.type(again, '  새 이름  {enter}');
    const row = await within(listNav()).findByRole('link', { name: /새 이름/ });
    expect(server.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      title: '새 이름',
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('새 이름');
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('빈 이름은 보내지 않고 안내, 서버 검증 오류는 입력 아래 alert', async () => {
    const server = createFakeServer(fetchMock, {
      conversations: [conversation({ title: '이름' })],
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '이름 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '대화 이름' });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('대화 이름을 입력하세요');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(server.count('PATCH', /conversations\//)).toBe(0);
    // 입력란 maxLength 100 — 서버 검증 문구는 그대로 보인다 (101자를 직접 넣어 서버 오류 경로 확인)
    expect(input).toHaveAttribute('maxLength', '100');
  });
});

describe('삭제 (확인 모달)', () => {
  it('삭제 → 되돌릴 수 없음 안내 모달, 취소는 요청 없음; 확인하면 DELETE·목록에서 제거·다음 행으로 포커스', async () => {
    const first = conversation({ title: '첫째' });
    const second = conversation({ title: '둘째' });
    const server = createFakeServer(fetchMock, { conversations: [first, second] });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '첫째 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    const dialog = screen.getByRole('dialog', { name: '대화 삭제' });
    expect(dialog).toHaveTextContent('「첫째」 대화를 삭제할까요?');
    expect(within(dialog).getByRole('note')).toHaveTextContent('되돌릴 수 없습니다');
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '대화 삭제' })).not.toBeInTheDocument(),
    );
    expect(server.count('DELETE', /conversations\//)).toBe(0);

    await userEvent.click(await screen.findByRole('button', { name: '첫째 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '대화 삭제' })).getByRole('button', {
        name: '삭제',
      }),
    );
    await waitFor(() =>
      expect(within(listNav()).queryByRole('link', { name: /첫째/ })).not.toBeInTheDocument(),
    );
    expect(server.count('DELETE', new RegExp(first.id))).toBe(1);
    await waitFor(() =>
      expect(within(listNav()).getByRole('link', { name: /둘째/ })).toHaveFocus(),
    );
  });

  it('지금 연 대화를 지우면 ?c= 를 replace 로 지우고, 마지막 대화면 포커스는 "새 대화"', async () => {
    const only = conversation({
      title: '유일',
      messages: [
        {
          id: 1,
          role: 'user',
          content: '지울 질문',
          action: null,
          createdAt: '2026-10-27T01:00:00.000Z',
        },
      ],
    });
    createFakeServer(fetchMock, { conversations: [only] });
    navigation.reset(PATH, `c=${only.id}`);
    renderPage();
    await within(log()).findByText('지울 질문');
    await userEvent.click(await screen.findByRole('button', { name: '유일 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '대화 삭제' })).getByRole('button', {
        name: '삭제',
      }),
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(PATH, { scroll: false }));
    await waitFor(() => expect(within(log()).queryByText('지울 질문')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '새 대화' })).toHaveFocus());
    expect(within(listNav()).getByText(/저장된 대화가 없습니다/)).toBeInTheDocument();
  });
});

describe('스트리밍·중지·다시 시도', () => {
  it('LLM 연결: Accept SSE → status 라벨·토큰 점진 → final(정본) 교체, 스트리밍 중 log aria-busy·중지 버튼·live region', async () => {
    const gates = [gate(), gate(), gate()];
    const target = conversation();
    createFakeServer(fetchMock, {
      status: statusView('ready'),
      conversations: [target],
      chat: ({ signal }) =>
        sseResponse(
          [
            sse('status', { label: '가격을 조회하는 중…' }),
            sse('token', { text: '첫 ' }) + sse('token', { text: '토큰' }),
            sse('final', { ...reply({ reply: '정본 답변', mode: 'llm', llm: LLM_READY }) }) +
              sse('done', {}),
          ],
          { gates: gates.map((g) => g.promise), signal },
        ),
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await screen.findByRole('note', { name: '과금 안내' });
    await ask('가격');
    expect(screen.getByRole('button', { name: '중지' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '보내기' })).not.toBeInTheDocument();
    expect(log()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('답변을 쓰는 중…', { selector: 'p' })).toHaveAttribute(
      'role',
      'status',
    );
    await act(async () => gates[0]!.release());
    expect(await within(log()).findByText('가격을 조회하는 중…')).toBeInTheDocument();
    await act(async () => gates[1]!.release());
    expect(await within(log()).findByText('첫 토큰')).toBeInTheDocument();
    await act(async () => gates[2]!.release());
    expect(await within(log()).findByText('정본 답변')).toBeInTheDocument();
    expect(within(log()).queryByText('첫 토큰')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).toBeInTheDocument();
    expect(log()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('답변을 받았습니다.')).toBeInTheDocument();
  });

  it('중지 → 요청 abort, 부분 출력은 버리고 "답변을 중단했습니다." + 다시 시도 → 같은 질문을 다시 보낸다(사용자 말풍선 1개)', async () => {
    const hold = gate();
    let attempt = 0;
    const target = conversation();
    const server = createFakeServer(fetchMock, {
      status: statusView('ready'),
      conversations: [target],
      chat: ({ signal }) => {
        attempt += 1;
        if (attempt === 1)
          return sseResponse([sse('token', { text: '부분 ' }), sse('token', { text: '출력' })], {
            gates: [undefined, hold.promise],
            signal,
          });
        return sseResponse([
          sse('final', reply({ reply: '다시 받은 답', mode: 'llm', llm: LLM_READY })),
          sse('done', {}),
        ]);
      },
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await screen.findByRole('note', { name: '과금 안내' });
    await ask('중지할 질문');
    await within(log()).findByText('부분');
    await userEvent.click(screen.getByRole('button', { name: '중지' }));
    expect(server.chatCalls[0]!.signal?.aborted).toBe(true);
    expect(await within(log()).findByText('답변을 중단했습니다.')).toBeInTheDocument();
    expect(within(log()).queryByText(/부분/)).not.toBeInTheDocument();
    expect(screen.getByText(/답변을 받지 못했습니다/)).toBeInTheDocument();

    await userEvent.click(within(log()).getByRole('button', { name: '다시 시도' }));
    expect(await within(log()).findByText('다시 받은 답')).toBeInTheDocument();
    expect(server.chatCalls[1]!.body).toEqual({
      message: '중지할 질문',
      conversationId: target.id,
      domain: 'pricing',
    });
    expect(users()).toHaveLength(1);
    expect(within(log()).queryByText('답변을 중단했습니다.')).not.toBeInTheDocument();
    expect(within(log()).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('서버 오류 봉투(429) → 오류 말풍선 + 다시 시도, 성공하면 오류 말풍선이 사라진다', async () => {
    let attempt = 0;
    const target = conversation();
    createFakeServer(fetchMock, {
      conversations: [target],
      chat: () => {
        attempt += 1;
        return attempt === 1
          ? json(
              {
                ok: false,
                error: {
                  code: 'RATE_LIMITED',
                  message: '요청이 너무 잦습니다. 12초 후 다시 시도하세요',
                },
              },
              429,
            )
          : json({ ok: true, data: reply({ reply: '이번엔 답' }) });
      },
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await screen.findByRole('status', { name: 'LLM 연결 안내' });
    await ask('질문');
    const error = await within(log()).findByText(/요청이 너무 잦습니다/);
    expect(error.closest('[data-from="bot"]')).toHaveClass('bg-error-50');
    await userEvent.click(within(log()).getByRole('button', { name: '다시 시도' }));
    expect(await within(log()).findByText('이번엔 답')).toBeInTheDocument();
    expect(within(log()).queryByText(/요청이 너무 잦습니다/)).not.toBeInTheDocument();
    expect(bots()).toHaveLength(1);
  });

  it('DB 에서 읽은 대화의 마지막이 답 없는 질문이면 "답변이 없습니다" + 다시 시도', async () => {
    const target = conversation({
      messages: [
        {
          id: 7,
          role: 'user',
          content: '답 없는 질문',
          action: null,
          createdAt: '2026-10-27T01:00:00.000Z',
        },
      ],
    });
    const server = createFakeServer(fetchMock, {
      conversations: [target],
      chat: () => json({ ok: true, data: reply({ reply: '늦은 답' }) }),
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    expect(await within(log()).findByText('이 질문에는 답변이 없습니다.')).toBeInTheDocument();
    await userEvent.click(within(log()).getByRole('button', { name: '다시 시도' }));
    expect(await within(log()).findByText('늦은 답')).toBeInTheDocument();
    expect(server.chatCalls[0]!.body.message).toBe('답 없는 질문');
    expect(users()).toHaveLength(1);
  });

  it('다른 대화로 옮기면 진행 중인 스트림을 중단한다', async () => {
    const hold = gate();
    const a = conversation({ title: '대화 A' });
    const b = conversation({ title: '대화 B' });
    const server = createFakeServer(fetchMock, {
      status: statusView('ready'),
      conversations: [a, b],
      chat: ({ signal }) =>
        sseResponse([sse('token', { text: '진행 중' }), sse('done', {})], {
          gates: [undefined, hold.promise],
          signal,
        }),
    });
    navigation.reset(PATH, `c=${a.id}`);
    renderPage();
    await screen.findByRole('note', { name: '과금 안내' });
    await ask('A 질문');
    await within(log()).findByText('진행 중');
    await userEvent.click(within(listNav()).getByRole('link', { name: /대화 B/ }));
    await waitFor(() => expect(server.chatCalls[0]!.signal?.aborted).toBe(true));
    await waitFor(() => expect(within(log()).queryByText('A 질문')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '보내기' })).toBeInTheDocument();
  });

  it('LLM 미연결: JSON 경로(Accept 없음), 배너·설정 링크, 답에는 짧은 안내 한 줄', async () => {
    const target = conversation();
    const server = createFakeServer(fetchMock, {
      conversations: [target],
      chat: () =>
        json({
          ok: true,
          data: reply({
            reply: '규칙 답',
            mode: 'rule',
            setup: { status: 'missing', message: MISSING_MESSAGE, href: '/settings#llm' },
          }),
        }),
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    const banner = await screen.findByRole('status', { name: 'LLM 연결 안내' });
    expect(banner).toHaveTextContent(MISSING_MESSAGE);
    expect(within(banner).getByRole('link', { name: /사용자 설정에서 등록하기/ })).toHaveAttribute(
      'href',
      '/settings#llm',
    );
    await ask('가격');
    expect(await within(log()).findByText('규칙 답')).toBeInTheDocument();
    expect(within(log()).getByText('LLM 미연결 — 기본 응답')).toBeInTheDocument();
    expect(within(log()).queryByText(MISSING_MESSAGE)).not.toBeInTheDocument();
    expect(server.chatCalls[0]!.accept).toBeNull();
    expect(server.chatCalls[0]!.body).not.toHaveProperty('history');
  });

  it('과금 고지는 닫으면 숨김; 견적 → 제품 퀵칩, 후보 → 후보 칩(품번으로 다시 질문)', async () => {
    const target = conversation();
    const replies = [
      reply({
        intent: 'quote',
        reply: '어떤 제품?',
        showProductChips: true,
        mode: 'llm',
        llm: LLM_READY,
      }),
      reply({
        reply: '여러 품목',
        candidates: [{ itemCode: 'P2', itemName: 'Wapples-2200 RAID', productFamily: 'WAPPLES' }],
        mode: 'llm',
        llm: LLM_READY,
      }),
      reply({ reply: '마지막 답', mode: 'llm', llm: LLM_READY }),
    ];
    const server = createFakeServer(fetchMock, {
      status: statusView('ready'),
      conversations: [target],
      chat: () => sseResponse([sse('final', replies.shift()), sse('done', {})]),
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '과금 안내 닫기' }));
    expect(screen.queryByRole('note', { name: '과금 안내' })).not.toBeInTheDocument();
    await ask('견적 뽑아줘');
    const products = await within(log()).findByRole('group', { name: '제품 선택' });
    await userEvent.click(within(products).getByRole('button', { name: 'WAPPLES' }));
    const candidates = await within(log()).findByRole('group', { name: '후보 품목' });
    expect(server.chatCalls[1]!.body.message).toBe('WAPPLES 견적');
    await userEvent.click(
      within(candidates).getByRole('button', { name: 'Wapples-2200 RAID (P2)' }),
    );
    expect(await within(log()).findByText('마지막 답')).toBeInTheDocument();
    expect(server.chatCalls[2]!.body.message).toBe('P2');
  });

  it('AC-227 ④: 답 텍스트 속 URL 은 링크로 만들지 않는다 — 링크는 action.href 뿐', async () => {
    const target = conversation();
    createFakeServer(fetchMock, {
      conversations: [target],
      chat: () =>
        json({
          ok: true,
          data: reply({
            reply: '자세한 건 https://evil.example/steal 를 보세요',
            action: {
              type: 'calculator',
              href: '/calculator?family=WAPPLES',
              label: '계산기에서 열기',
            },
          }),
        }),
    });
    navigation.reset(PATH, `c=${target.id}`);
    renderPage();
    await screen.findByRole('status', { name: 'LLM 연결 안내' });
    await ask('질문');
    await within(log()).findByText(/evil\.example/);
    expect(
      within(log())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/calculator?family=WAPPLES']);
    expect(log().innerHTML).not.toMatch(/href="https?:\/\/evil/);
  });
});

describe('조달 챗봇', () => {
  it('domain=procurement 로 목록·생성·전송, 서버의 "아직 준비 중" 거부를 오류 말풍선 그대로 보여 준다', async () => {
    navigation.reset('/procurement/chat', '');
    const server = createFakeServer(fetchMock, {
      chat: () =>
        json(
          { ok: false, error: { code: 'VALIDATION', message: '조달 챗봇은 아직 준비 중입니다' } },
          400,
        ),
    });
    renderPage('procurement');
    expect(await within(listNav()).findByText(/저장된 대화가 없습니다/)).toBeInTheDocument();
    expect(server.count('GET', /conversations\?domain=procurement$/)).toBe(1);
    const examples = within(log()).getByRole('group', { name: '예시 질문' });
    expect(
      within(examples)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([...PROCUREMENT_EXAMPLE_QUESTIONS]);
    await userEvent.click(
      within(examples).getByRole('button', { name: PROCUREMENT_EXAMPLE_QUESTIONS[0] }),
    );
    const error = await within(log()).findByText('조달 챗봇은 아직 준비 중입니다');
    expect(error.closest('[data-from="bot"]')).toHaveClass('text-text-danger');
    expect(
      server.calls.find((call) => call.method === 'POST' && call.url === '/api/chat/conversations')
        ?.body,
    ).toEqual({
      domain: 'procurement',
    });
    expect(server.chatCalls[0]!.body.domain).toBe('procurement');
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/procurement\/chat\?c=/),
      { scroll: false },
    );
    // 꾸며 낸 답 없음 — 봇 말풍선은 오류 하나뿐
    expect(bots()).toHaveLength(1);
  });
});

describe('좁은 화면 (768px 미만 — 목록 또는 대화 한 화면씩)', () => {
  const root = () => document.querySelector<HTMLElement>('[data-mobile-view]')!;

  it('?c= 없고 목록이 있으면 목록 화면, 행을 고르면 대화 화면, "대화 목록" 버튼으로 돌아온다', async () => {
    const target = conversation({ title: '모바일 대화' });
    createFakeServer(fetchMock, { conversations: [target] });
    renderPage();
    await within(listNav()).findByRole('link', { name: /모바일 대화/ });
    expect(root()).toHaveAttribute('data-mobile-view', 'list');
    expect(screen.getByTestId('chat-pane-column')).toHaveClass('max-md:hidden');
    expect(screen.getByTestId('chat-list-column')).not.toHaveClass('max-md:hidden');

    await userEvent.click(within(listNav()).getByRole('link', { name: /모바일 대화/ }));
    await waitFor(() => expect(root()).toHaveAttribute('data-mobile-view', 'conversation'));
    expect(screen.getByTestId('chat-list-column')).toHaveClass('max-md:hidden');
    expect(screen.getByTestId('chat-pane-column')).not.toHaveClass('max-md:hidden');
    const back = screen.getByRole('button', { name: '대화 목록' });
    expect(back).toHaveClass('md:hidden');
    await userEvent.click(back);
    expect(navigation.push).toHaveBeenLastCalledWith(PATH, { scroll: false });
    await waitFor(() => expect(root()).toHaveAttribute('data-mobile-view', 'list'));
  });

  it('"새 대화"는 ?c= 없이도 대화 화면을 연다, 목록이 비어 있으면 처음부터 대화 화면(돌아갈 목록 버튼 없음)', async () => {
    createFakeServer(fetchMock, { conversations: [conversation()] });
    const { unmount } = renderPage();
    await within(listNav()).findAllByRole('link');
    expect(root()).toHaveAttribute('data-mobile-view', 'list');
    await userEvent.click(screen.getByRole('button', { name: '새 대화' }));
    expect(root()).toHaveAttribute('data-mobile-view', 'conversation');
    await userEvent.click(screen.getByRole('button', { name: '대화 목록' }));
    expect(root()).toHaveAttribute('data-mobile-view', 'list');
    unmount();

    fetchMock.mockReset();
    createFakeServer(fetchMock);
    renderPage();
    await within(listNav()).findByText(/저장된 대화가 없습니다/);
    expect(root()).toHaveAttribute('data-mobile-view', 'conversation');
    expect(screen.queryByRole('button', { name: '대화 목록' })).not.toBeInTheDocument();
  });
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

describe('저장 위치 (I-6 개정)', () => {
  it('화면 코드(src/features/chat)에 sessionStorage/localStorage 사용이 없다 — 대화는 서버 DB 에만', () => {
    const dir = path.join(process.cwd(), 'src/features/chat');
    for (const name of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, name), 'utf8')).not.toMatch(/sessionStorage|localStorage/);
    }
  });
});
