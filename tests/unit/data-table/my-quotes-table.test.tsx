import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CartPanel } from '@/features/calculator/CartPanel';
import type { SavedQuoteView } from '@/features/calculator/types';

/** #32 PR-2: 내 견적 목록(전체보기 모달) 표가 공용 DataTable(클라이언트 정렬)로 동작하고, 모달 안 조작으로 닫히지 않는다 */

const quote = (patch: Partial<SavedQuoteView> & Pick<SavedQuoteView, 'id' | 'quoteNo'>) =>
  ({
    productFamily: 'WAPPLES',
    title: `견적 ${patch.quoteNo}`,
    summary: '요약',
    totalAmount: '1000',
    currency: 'KRW',
    createdAt: '2026-09-01T00:00:00.000Z',
    ownerUserId: 'u1',
    lines: [],
    ...patch,
  }) as SavedQuoteView;

/** 기본 순서 = 서버 순서(최신 먼저) */
const SAVED: SavedQuoteView[] = [
  quote({ id: 'q1', quoteNo: 'Q-0001', totalAmount: '5000', currency: 'KRW' }),
  quote({ id: 'q2', quoteNo: 'Q-0002', totalAmount: '30', currency: 'USD' }),
  quote({ id: 'q3', quoteNo: 'Q-0003', totalAmount: null, currency: null }),
  quote({ id: 'q4', quoteNo: 'Q-0004', totalAmount: '200', currency: 'KRW' }),
  quote({ id: 'q5', quoteNo: 'Q-0005', totalAmount: '10', currency: 'USD' }),
];

const noop = () => undefined;

function renderPanel(saved: SavedQuoteView[] = SAVED) {
  return render(
    <CartPanel
      userId="u1"
      lines={[]}
      saved={saved}
      isPending={false}
      activeQuote={null}
      onRemove={noop}
      onReset={noop}
      onSave={noop}
      onReload={noop}
      onDelete={noop}
      onShare={noop}
    />,
  );
}

async function openModal() {
  await userEvent.click(screen.getByRole('button', { name: '전체보기' }));
  return screen.getByRole('dialog', { name: '내 견적 목록' });
}

const table = () => screen.getByRole('table', { name: '견적 목록 표' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const headers = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent);
const quoteNos = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

/** 브라우저처럼: Esc keydown 이 preventDefault 되지 않았으면 <dialog> 에 cancel 이 간다 */
function pressEscape(target: Element, dialog: HTMLElement): boolean {
  const notPrevented = fireEvent.keyDown(target, { key: 'Escape' });
  if (notPrevented) fireEvent(dialog, new Event('cancel', { cancelable: true }));
  return notPrevented;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom 은 레이아웃이 없다 — th 는 순서대로 100px 폭
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'TH' && this.parentElement) {
      const index = Array.from(this.parentElement.children).indexOf(this);
      return new DOMRect(index * 100, 0, 100, 40);
    }
    return new DOMRect(0, 0, 0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('내 견적 목록 표 (DataTable, tableId my-quotes)', () => {
  it('헤더 텍스트·순서는 그대로이고 클릭하면 aria-sort 가 오름 → 내림 → 없음, 기본 순서로 돌아온다', async () => {
    renderPanel();
    await openModal();
    expect(headers()).toEqual(['견적 번호', '일자', '제품', '내용', '금액', ' ']);
    const button = within(th('견적 번호')).getByRole('button');

    await userEvent.click(button);
    expect(th('견적 번호')).toHaveAttribute('aria-sort', 'ascending');
    expect(quoteNos()).toEqual(['Q-0001', 'Q-0002', 'Q-0003', 'Q-0004', 'Q-0005']);
    await userEvent.click(button);
    expect(th('견적 번호')).toHaveAttribute('aria-sort', 'descending');
    expect(quoteNos()).toEqual(['Q-0005', 'Q-0004', 'Q-0003', 'Q-0002', 'Q-0001']);
    await userEvent.click(button);
    expect(th('견적 번호')).not.toHaveAttribute('aria-sort');
    expect(quoteNos()).toEqual(['Q-0001', 'Q-0002', 'Q-0003', 'Q-0004', 'Q-0005']);
  });

  it('금액은 통화로 먼저 묶고 통화 안에서 금액순, 통화 혼합(빈 값)은 방향과 관계없이 맨 뒤', async () => {
    renderPanel();
    await openModal();
    const button = within(th('금액')).getByRole('button');
    await userEvent.click(button);
    expect(quoteNos()).toEqual(['Q-0004', 'Q-0001', 'Q-0005', 'Q-0002', 'Q-0003']);
    await userEvent.click(button);
    expect(quoteNos()).toEqual(['Q-0002', 'Q-0005', 'Q-0001', 'Q-0004', 'Q-0003']);
  });

  it("관리(액션) 열은 정렬 버튼·aria-sort 가 없고 끝에 고정, '열 초기화'는 기본 상태에서 비활성", async () => {
    renderPanel();
    const dialog = await openModal();
    const actions = within(table()).getAllByRole('columnheader')[5] as HTMLElement;
    expect(within(actions).queryByRole('button')).toBeNull();
    expect(actions).not.toHaveAttribute('aria-sort');
    expect(within(dialog).getByRole('button', { name: '열 초기화' })).toBeDisabled();

    // 마지막 데이터 열을 오른쪽으로 옮겨도 관리 열 너머로 가지 않는다
    within(th('금액')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(headers()).toEqual(['견적 번호', '일자', '제품', '내용', '금액', ' ']);
    expect(within(dialog).getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });

  it('저장 키는 현재 사용자 id 로 구분되고, 열을 옮기면 열 초기화가 켜진다', async () => {
    renderPanel();
    const dialog = await openModal();
    within(th('견적 번호')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(headers()).toEqual(['일자', '견적 번호', '제품', '내용', '금액', ' ']);
    expect(localStorage.getItem('prami:table:my-quotes:v1:u1')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: '열 초기화' })).toBeEnabled();
  });

  it('행(<tr>)에는 transform·layout 애니메이션 스타일이 없다', async () => {
    renderPanel();
    await openModal();
    await userEvent.click(within(th('금액')).getByRole('button'));
    for (const row of within(table()).getAllByRole('row')) {
      expect(row.getAttribute('style') ?? '').not.toMatch(/transform/);
    }
  });
});

describe('내 견적 목록 모달 — 표 조작으로 닫히지 않는다 (#32 스펙 §7)', () => {
  it('헤더 클릭(정렬)은 모달을 닫지 않는다', async () => {
    renderPanel();
    const dialog = await openModal();
    await userEvent.click(within(th('일자')).getByRole('button'));
    await userEvent.click(within(th('일자')).getByRole('button'));
    expect(dialog).toBeInTheDocument();
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  it('헤더를 5px 이상 끌어 대화상자 밖(백드롭)에서 놓아도 닫히지 않는다 — 공통 조상 <dialog> 의 click 무시', async () => {
    renderPanel();
    const dialog = await openModal();
    const button = within(th('견적 번호')).getByRole('button');
    fireEvent.pointerDown(button, { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 260, clientY: 12 });
    expect(screen.getByTestId('data-table-drag-ghost')).toBeInTheDocument();
    fireEvent.pointerUp(dialog, { clientX: 260, clientY: 12 });
    // 브라우저는 pointerdown(헤더 버튼)·pointerup(<dialog> 백드롭) 대상의 공통 조상 = <dialog> 에 click 을 보낸다
    fireEvent.click(dialog);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog).toBeInTheDocument();
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(headers()).toEqual(['일자', '제품', '견적 번호', '내용', '금액', ' ']);
  });

  it('진짜 백드롭 클릭(백드롭에서 누르고 뗌)은 그대로 모달을 닫는다', async () => {
    renderPanel();
    const dialog = await openModal();
    fireEvent.pointerDown(dialog, { pointerType: 'mouse', button: 0 });
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('드래그 중 Esc 는 드래그만 취소하고 모달은 닫지 않는다. 평소 Esc 는 모달을 닫는다', async () => {
    renderPanel();
    const dialog = await openModal();
    const button = within(th('견적 번호')).getByRole('button');
    button.focus();
    fireEvent.pointerDown(button, { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 260, clientY: 10 });
    expect(screen.getByTestId('data-table-drag-ghost')).toBeInTheDocument();

    expect(pressEscape(button, dialog)).toBe(false); // preventDefault → cancel 로 이어지지 않음
    expect(screen.queryByTestId('data-table-drag-ghost')).toBeNull();
    fireEvent.pointerUp(document, { clientX: 260, clientY: 10 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(headers()).toEqual(['견적 번호', '일자', '제품', '내용', '금액', ' ']);

    expect(pressEscape(button, dialog)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
