import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BidKeywordBoard, BidKeywordView } from '@/server/procurement/keywords';

/**
 * 조달이 통합 UI-8 키워드 관리 화면 — 칩 편집 흐름(키보드). Server Action 은 모킹(합성 키워드만).
 * Enter 로 추가, × 버튼 접근 이름 "{키워드} 삭제" → Prami 확인 모달 → 삭제, 입력 검사(중복·제어 문자),
 * 동시 편집 CONFLICT → "이미 처리됨" 안내 + router.refresh(). confirm/alert 를 쓰지 않는다.
 */
const actions = vi.hoisted(() => ({
  addBidKeywordAction: vi.fn(),
  deleteBidKeywordAction: vi.fn(),
}));
vi.mock('@/features/procurement/admin/keywords/actions', () => actions);
// 쓰기 뒤 router.refresh() → RSC(KeywordsAdminSection)가 새 board 를 내려 준다 — 테스트는 refresh 호출을 보고 rerender 로 흉내 낸다
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { KeywordAdminPanel } =
  await import('@/features/procurement/admin/keywords/KeywordAdminPanel');

function kw(
  id: number,
  product: BidKeywordView['product'],
  keyword: string,
  addedBy: string | null = null,
) {
  return {
    id,
    product,
    keyword,
    addedBy,
    createdAt: '2026-10-01T00:00:00.000Z',
  } satisfies BidKeywordView;
}

const BOARD: BidKeywordBoard = {
  keywords: [
    kw(1, 'WAPPLES', '가상 방화벽'),
    kw(2, 'WAPPLES', '가상 WAF', 'tester'),
    kw(3, '제외', '가상 제외어'),
  ],
  lastCheckedAt: '2026-10-20T01:30:00.000Z',
};

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (code: string, message: string, fieldErrors?: Record<string, string[]>) => ({
  ok: false as const,
  error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) },
});

const confirmSpy = vi.fn();
const alertSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = confirmSpy;
  window.alert = alertSpy;
});

async function renderPanel(board: BidKeywordBoard = BOARD) {
  const view = render(<KeywordAdminPanel board={board} />);
  await screen.findByRole('group', { name: 'WAPPLES' });
  return { rerender: (next: BidKeywordBoard) => view.rerender(<KeywordAdminPanel board={next} />) };
}

describe('KeywordAdminPanel', () => {
  it('그룹 4개(제품 3 + 제외 단어)·건수·칩, 마지막 확인 시각(KST), 직접 추가 표시', async () => {
    await renderPanel();
    expect(screen.getByRole('heading', { name: '분류 키워드' })).toBeInTheDocument();
    expect(screen.getByTestId('procurement-keywords-last-checked')).toHaveTextContent(
      '2026-10-20 10:30 (KST)',
    );
    for (const name of ['WAPPLES', 'D.AMO', 'iSIGN', '제외 단어']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    }
    const wapples = screen.getByRole('group', { name: 'WAPPLES' });
    expect(within(wapples).getByText('2개')).toBeInTheDocument();
    const chips = within(wapples).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['가상 방화벽', '가상 WAF']);
    expect(chips[0]).toHaveAttribute('title', '기본 키워드');
    expect(chips[1]).toHaveAttribute('title', '추가: tester');
    expect(chips[1]).toHaveAttribute('data-manual');
    expect(
      within(screen.getByRole('group', { name: 'D.AMO' })).getByText('키워드 없음'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: '제외 단어' })).getByText(
        '이 단어가 들어간 공고는 버립니다',
      ),
    ).toBeInTheDocument();
  });

  it('마지막 확인 기록이 없으면 "확인 기록 없음"', async () => {
    await renderPanel({ ...BOARD, lastCheckedAt: null });
    expect(screen.getByTestId('procurement-keywords-last-checked')).toHaveTextContent(
      '확인 기록 없음',
    );
  });

  it('Enter 로 추가 → 정규화한 값으로 Action 호출, 입력 비움, 안내 + 새로 불러오기', async () => {
    const view = await renderPanel();
    actions.addBidKeywordAction.mockResolvedValue(ok(kw(9, 'D.AMO', '가상 암호화', 'tester')));
    const input = screen.getByRole('textbox', { name: 'D.AMO 키워드 추가' });
    await userEvent.type(input, '  가상   암호화 {Enter}');
    expect(actions.addBidKeywordAction).toHaveBeenCalledWith({
      product: 'D.AMO',
      keyword: '가상 암호화',
    });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByRole('status')).toHaveTextContent('추가했습니다: 가상 암호화');
    expect(refresh).toHaveBeenCalledTimes(1);
    view.rerender({
      ...BOARD,
      keywords: [...BOARD.keywords, kw(9, 'D.AMO', '가상 암호화', 'tester')],
    });
    expect(
      within(screen.getByRole('group', { name: 'D.AMO' })).getByRole('button', {
        name: '가상 암호화 삭제',
      }),
    ).toBeInTheDocument();
  });

  it('빈 입력은 Enter 해도 호출하지 않고, 추가 버튼은 꺼져 있다', async () => {
    await renderPanel();
    const group = screen.getByRole('group', { name: 'iSIGN' });
    expect(within(group).getByRole('button', { name: '추가' })).toBeDisabled();
    await userEvent.type(within(group).getByRole('textbox'), '   {Enter}');
    expect(actions.addBidKeywordAction).not.toHaveBeenCalled();
  });

  it('그룹 안 중복·제어 문자는 화면에서 막고(Action 미호출) 입력 아래 안내', async () => {
    await renderPanel();
    const group = screen.getByRole('group', { name: 'WAPPLES' });
    const input = within(group).getByRole('textbox', { name: 'WAPPLES 키워드 추가' });
    await userEvent.type(input, ' 가상  방화벽{Enter}');
    expect(within(group).getByRole('alert')).toHaveTextContent(
      '이미 있는 키워드입니다: 가상 방화벽',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // 같은 단어라도 다른 그룹(제외)은 허용
    actions.addBidKeywordAction.mockResolvedValue(ok(kw(10, '제외', '가상 방화벽', 'tester')));
    await userEvent.type(
      screen.getByRole('textbox', { name: '제외 단어 추가' }),
      '가상 방화벽{Enter}',
    );
    expect(actions.addBidKeywordAction).toHaveBeenCalledWith({
      product: '제외',
      keyword: '가상 방화벽',
    });

    // 라틴 문자 대소문자 무시: 'WAF' 가 있으면 '가상 waf' 도 중복
    await userEvent.clear(input);
    await userEvent.type(input, '가상 waf{Enter}');
    expect(within(group).getByRole('alert')).toHaveTextContent('이미 있는 키워드입니다: 가상 WAF');
    expect(actions.addBidKeywordAction).toHaveBeenCalledTimes(1);

    await userEvent.clear(input);
    await userEvent.type(input, '가상\u200b키워드');
    await userEvent.click(within(group).getByRole('button', { name: '추가' }));
    expect(within(group).getByRole('alert')).toHaveTextContent('제어 문자나 보이지 않는 문자는');
    expect(actions.addBidKeywordAction).toHaveBeenCalledTimes(1);
  });

  it('서버 VALIDATION 은 입력 아래, 동시 추가 CONFLICT 는 "이미 처리됨" 안내 + 새로 불러오기', async () => {
    await renderPanel();
    const input = screen.getByRole('textbox', { name: 'iSIGN 키워드 추가' });
    actions.addBidKeywordAction.mockResolvedValueOnce(
      fail('VALIDATION', '키워드는 50자 이하로 입력하세요', {
        keyword: ['키워드는 50자 이하로 입력하세요'],
      }),
    );
    await userEvent.type(input, '가상{Enter}');
    expect(
      await within(screen.getByRole('group', { name: 'iSIGN' })).findByRole('alert'),
    ).toHaveTextContent('50자 이하');
    expect(input).toHaveValue('가상');

    actions.addBidKeywordAction.mockResolvedValueOnce(
      fail('CONFLICT', '이미 처리됨 — 이미 있는 키워드입니다: 가상'),
    );
    await userEvent.type(input, '{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '이미 처리됨 — 이미 있는 키워드입니다: 가상 — 목록을 새로 불러왔습니다',
      ),
    );
    expect(input).toHaveValue('');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('× 버튼(접근 이름 "{키워드} 삭제") → 확인 모달 → 취소하면 삭제하지 않는다', async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole('button', { name: '가상 방화벽 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '키워드 삭제' });
    expect(dialog).toHaveTextContent('가상 방화벽 키워드를 삭제할까요?');
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(actions.deleteBidKeywordAction).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('키보드로 × 에 가서 Enter → 모달 삭제 → 안내 + 새로 불러오기', async () => {
    const view = await renderPanel();
    actions.deleteBidKeywordAction.mockResolvedValue(ok(kw(3, '제외', '가상 제외어')));
    const remove = screen.getByRole('button', { name: '가상 제외어 삭제' });
    remove.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: '키워드 삭제' });
    expect(dialog).toHaveTextContent('가상 제외어 제외 단어를 삭제할까요?');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(actions.deleteBidKeywordAction).toHaveBeenCalledWith({ id: 3 });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('삭제했습니다: 가상 제외어'),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    view.rerender({ ...BOARD, keywords: BOARD.keywords.filter((row) => row.id !== 3) });
    expect(screen.queryByRole('button', { name: '가상 제외어 삭제' })).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('이미 삭제된 키워드 → "이미 처리됨" 안내, 모달 닫고 새로 불러오기', async () => {
    await renderPanel();
    actions.deleteBidKeywordAction.mockResolvedValue(
      fail('CONFLICT', '이미 처리됨 — 이미 삭제된 키워드입니다'),
    );
    await userEvent.click(screen.getByRole('button', { name: '가상 WAF 삭제' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '이미 처리됨 — 이미 삭제된 키워드입니다',
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('그 밖의 삭제 오류는 모달 안에 보이고 모달은 열려 있다', async () => {
    await renderPanel();
    actions.deleteBidKeywordAction.mockResolvedValue(
      fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다'),
    );
    await userEvent.click(screen.getByRole('button', { name: '가상 WAF 삭제' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('권한이 없습니다');
  });
});
