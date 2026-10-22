import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import type { SavedQuoteView } from '@/features/calculator/types';
import type { NoticeDetailView } from '@/features/notices/types';
import type { PartMappingView } from '@/features/parts/types';
import type { UserRow } from '@/features/users/UsersTable';

import { navigation } from '../../helpers/next-navigation';
import {
  activeFields,
  check,
  fieldButton,
  openField,
  quickFilter,
  range,
  typeText,
} from './quick-helpers';

/**
 * 클라이언트 4표 열 필터 (표 열 필터 스펙 §1·§4 + 빠른 필터 바 §2): 2개 조건 AND·건수·필터 결과 0건 빈 상태·URL(f.*) 반영,
 * 표별 고정 필드 버튼(§2.2)·"＋ N개 더"·별도 칩 줄 없음.
 * 내 견적 목록(모달)은 URL 대신 컴포넌트 상태, 모달 안 Esc 는 팝오버만 닫는다.
 */
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);
vi.mock('@/features/users/actions', () => ({
  createUserAction: vi.fn(),
  updateUserAction: vi.fn(),
  deactivateUserAction: vi.fn(),
}));
vi.mock('@/features/notices/actions', () => ({
  upsertNoticeAction: vi.fn(),
  deleteNoticeAction: vi.fn(),
}));

const { UsersTable } = await import('@/features/users/UsersTable');
const { NoticesAdminTable } = await import('@/features/notices/NoticesAdminTable');
const { PartsMappingTable } = await import('@/features/parts/PartsMappingTable');
const { CartPanel } = await import('@/features/calculator/CartPanel');

const withMotion = { wrapper: MotionProvider };
const firstCells = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const query = () => new URLSearchParams(navigation.search());

beforeEach(() => {
  localStorage.clear();
});

// ── 사용자 (파일럿) ───────────────────────────────────────────────────────

const user = (patch: Partial<UserRow> & Pick<UserRow, 'id' | 'name'>): UserRow => ({
  email: `${patch.id}@pentasecurity.com`,
  department: null,
  role: 'USER',
  status: 'active',
  createdVia: 'admin',
  lastLoginAt: null,
  ...patch,
});

const USERS: UserRow[] = [
  user({ id: 'a', name: '나', lastLoginAt: '2026-09-02T00:00:00.000Z', department: '영업팀' }),
  user({ id: 'b', name: '가', role: 'ADMIN', status: 'inactive' }),
  user({ id: 'c', name: '다', lastLoginAt: '2026-08-01T00:00:00.000Z' }),
  user({ id: 'd', name: '라', role: 'ADMIN', department: '영업2팀' }),
];

describe('UsersTable 열 필터 (파일럿)', () => {
  beforeEach(() => navigation.reset('/admin/users'));

  it('고정 필드 이름·부서·역할·상태 + "＋ 2개 더"(이메일·마지막 로그인), 상태 = 비활성 2클릭', async () => {
    const ue = userEvent.setup();
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    expect(
      screen
        .getAllByRole('button', { name: / 필터$/ })
        .filter((b) => b.hasAttribute('data-quick-field'))
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['이름 필터', '부서 필터', '역할 필터', '상태 필터']);
    expect(screen.getByText('4건')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '적용된 필터' })).toBeNull();

    await ue.click(fieldButton('상태'));
    await ue.click(
      within(await screen.findByRole('dialog', { name: '상태 필터' })).getByRole('checkbox', {
        name: '비활성',
      }),
    );
    expect(firstCells('사용자 목록')).toEqual(['가']);
    expect(fieldButton('상태')).toHaveAccessibleName('상태 필터, 비활성 적용 중');
    expect(navigation.replace).toHaveBeenLastCalledWith('/admin/users?f.status.in=inactive', {
      scroll: false,
    });

    await ue.keyboard('{Escape}');
    await ue.click(screen.getByRole('button', { name: '＋ 2개 더' }));
    const picker = await screen.findByRole('dialog', { name: '필터 더 보기' });
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['이메일', '마지막 로그인']);
  });

  it('역할 ADMIN + 부서 "영업" 포함 → 1건, URL f.*·건수·필드 버튼·점', async () => {
    const ue = userEvent.setup();
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    await quickFilter(ue, '역할', check(ue, 'ADMIN'));
    await quickFilter(ue, '부서', typeText(ue, '영업'));
    expect(firstCells('사용자 목록')).toEqual(['라']);
    expect(activeFields()).toEqual(['부서: "영업" 포함', '역할: ADMIN']);
    expect(screen.getByText('전체 4건 중 1건')).toBeInTheDocument();
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/admin/users?f.department.has=%EC%98%81%EC%97%85&f.role.in=ADMIN',
      { scroll: false },
    );
    const th = within(screen.getByRole('table', { name: '사용자 목록' })).getByRole(
      'columnheader',
      {
        name: '역할',
      },
    );
    expect(th).toHaveAttribute('data-filtered', 'true');
  });

  it('상태(활성/비활성 라벨) + 마지막 로그인 기간', async () => {
    const ue = userEvent.setup();
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    await quickFilter(ue, '상태', check(ue, '활성'));
    await quickFilter(ue, '마지막 로그인', range(ue, '2026-09-01', null, 'date'));
    expect(activeFields()).toEqual(['상태: 활성', '마지막 로그인: 2026-09-01 ~']);
    expect(firstCells('사용자 목록')).toEqual(['나(나)']);
  });

  it('새로고침(URL 에 조건) → 같은 결과, 0건이면 "조건에 맞는 결과가 없습니다" + 필터 초기화', async () => {
    navigation.reset('/admin/users', 'f.name.eq=%EC%97%86%EC%9D%8C&f.role.in=USER');
    const ue = userEvent.setup();
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('전체 4건 중 0건')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '사용자 목록' });
    await ue.click(within(table).getByRole('button', { name: '필터 초기화' }));
    expect(navigation.search()).toBe('');
    expect(firstCells('사용자 목록')).toHaveLength(4);
    // 빈 상태의 [필터 초기화] 는 사라지므로 포커스는 바의 첫 필드 버튼으로 (A-1 QA 백로그 — 옛 바 테스트에서 이전)
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-table-filter-trigger'),
    );
  });

  it('사용자가 하나도 없으면 "등록된 사용자가 없습니다"', () => {
    render(<UsersTable users={[]} currentUserId="a" />, withMotion);
    expect(screen.getByText('등록된 사용자가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText('조건에 맞는 결과가 없습니다')).toBeNull();
  });
});

// ── 공지 관리 ─────────────────────────────────────────────────────────────

const notice = (
  patch: Partial<NoticeDetailView> & Pick<NoticeDetailView, 'id' | 'title'>,
): NoticeDetailView => ({
  authorName: '가격정책팀',
  isImportant: false,
  publishedAt: '2026-09-01',
  body: '본문',
  ...patch,
});

const NOTICES: NoticeDetailView[] = [
  notice({ id: 'n1', title: '가격 개정', publishedAt: '2026-09-10', isImportant: true }),
  notice({ id: 'n2', title: '가격 안내', publishedAt: '2026-08-01', isImportant: true }),
  notice({ id: 'n3', title: '점검', publishedAt: '2026-09-12' }),
];

describe('NoticesAdminTable 열 필터', () => {
  beforeEach(() => navigation.reset('/admin/notices'));

  it('고정 필드 제목·작성일·작성자·중요, "＋ 더" 없음', () => {
    render(<NoticesAdminTable notices={NOTICES} defaultAuthor="관리자" userId="u1" />, withMotion);
    expect(
      screen.getAllByRole('button', { name: / 필터$/ }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['제목 필터', '작성일 필터', '작성자 필터', '중요 필터']);
    expect(screen.queryByRole('button', { name: /개 더$/ })).toBeNull();
    expect(screen.getByText('3건')).toBeInTheDocument();
  });

  it('중요 + 작성일 기간 → AND, 건수·URL', async () => {
    const ue = userEvent.setup();
    render(<NoticesAdminTable notices={NOTICES} defaultAuthor="관리자" userId="u1" />, withMotion);
    await quickFilter(ue, '중요', check(ue, '중요'));
    await quickFilter(ue, '작성일', range(ue, '2026-09-01', '2026-09-30', 'date'));
    expect(firstCells('공지 관리 표')).toEqual(['가격 개정']);
    expect(activeFields()).toEqual(['작성일: 2026-09-01 ~ 2026-09-30', '중요: 중요']);
    expect(screen.getByText('전체 3건 중 1건')).toBeInTheDocument();
    expect([...query().keys()]).toEqual([
      'f.publishedAt.gte',
      'f.publishedAt.lte',
      'f.isImportant.in',
    ]);
  });

  it('0건 → 필터 빈 상태(데이터 없음 문구와 구분)', async () => {
    const ue = userEvent.setup();
    render(<NoticesAdminTable notices={NOTICES} defaultAuthor="관리자" userId="u1" />, withMotion);
    await quickFilter(ue, '제목', typeText(ue, '없는 제목'));
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    expect(screen.queryByText('등록된 공지가 없습니다.')).toBeNull();
  });
});

// ── 파츠 매핑 ─────────────────────────────────────────────────────────────

const mapping = (modelItemCode: string, modelName: string, parts: string[]): PartMappingView => ({
  modelItemCode,
  modelName,
  parts: parts.map((itemName, index) => ({ itemName, itemCode: `${modelItemCode}-${index}` })),
});

const MAPPINGS: PartMappingView[] = [
  mapping('H2700', 'Wapples-2700', ['N_1']),
  mapping('H300', 'Wapples-300', ['N_2']),
  mapping('K100', 'D.AMO KE', ['N_3']),
];

describe('PartsMappingTable 열 필터', () => {
  beforeEach(() => navigation.reset('/admin/parts', 'family=WAPPLES'));

  it('모델 열만 필터 가능(장착 파츠 목록 열은 없음, "＋ 더" 없음), 다시 열면 현재 조건이 채워진다', async () => {
    const ue = userEvent.setup();
    render(
      <PartsMappingTable mappings={MAPPINGS} onEdit={vi.fn()} onDelete={vi.fn()} userId="u1" />,
      withMotion,
    );
    expect(
      screen.getAllByRole('button', { name: / 필터$/ }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['모델 필터']);
    expect(screen.queryByRole('button', { name: /개 더$/ })).toBeNull();
    expect(screen.getByText('3건')).toBeInTheDocument();

    await quickFilter(ue, '모델', typeText(ue, 'wapples'));
    expect(activeFields()).toEqual(['모델: "wapples" 포함']);
    // 같은 필드 버튼을 다시 누르면 현재 조건이 채워져 있다
    await ue.click(fieldButton('모델'));
    const dialog = await screen.findByRole('dialog', { name: '모델 필터' });
    expect(within(dialog).getByRole('textbox', { name: '값' })).toHaveValue('wapples');
    expect(within(dialog).getByRole('button', { name: '포함' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('모델 "wapples" 포함 → 2건, 품번 같음 → 1건, URL 에 family 가 남는다', async () => {
    const ue = userEvent.setup();
    render(
      <PartsMappingTable mappings={MAPPINGS} onEdit={vi.fn()} onDelete={vi.fn()} userId="u1" />,
      withMotion,
    );
    await quickFilter(ue, '모델', typeText(ue, 'WAPPLES'));
    expect(screen.getByText('전체 3건 중 2건')).toBeInTheDocument();
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/admin/parts?family=WAPPLES&f.model.has=WAPPLES',
      { scroll: false },
    );
    await ue.click(screen.getByRole('button', { name: '모델 필터 해제' }));
    await quickFilter(ue, '모델', typeText(ue, 'k100', '같음'));
    expect(screen.getByText('전체 3건 중 1건')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(navigation.search()).toBe('family=WAPPLES');
  });

  it('0건 → 필터 빈 상태', async () => {
    const ue = userEvent.setup();
    render(
      <PartsMappingTable mappings={MAPPINGS} onEdit={vi.fn()} onDelete={vi.fn()} userId="u1" />,
      withMotion,
    );
    await quickFilter(ue, '모델', typeText(ue, 'zzz'));
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('전체 3건 중 0건')).toBeInTheDocument();
  });
});

// ── 내 견적 목록 (모달, 상태) ─────────────────────────────────────────────

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

const SAVED: SavedQuoteView[] = [
  quote({ id: 'q1', quoteNo: 'Q-0001', totalAmount: '5000', currency: 'KRW' }),
  quote({
    id: 'q2',
    quoteNo: 'Q-0002',
    totalAmount: '30',
    currency: 'USD',
    productFamily: 'D.AMO',
  }),
  quote({ id: 'q3', quoteNo: 'Q-0003', totalAmount: null, currency: null }),
  quote({ id: 'q4', quoteNo: 'Q-0004', totalAmount: '200', currency: 'KRW' }),
];

const noop = () => undefined;

async function openQuotes(ue: ReturnType<typeof userEvent.setup>) {
  render(
    <CartPanel
      userId="u1"
      lines={[]}
      saved={SAVED}
      isPending={false}
      activeQuote={null}
      onRemove={noop}
      onReset={noop}
      onSave={noop}
      onReload={noop}
      onDelete={noop}
      onShare={noop}
    />,
    withMotion,
  );
  await ue.click(screen.getByRole('button', { name: '전체보기' }));
  return screen.getByRole('dialog', { name: '내 견적 목록' });
}

describe('내 견적 목록 모달 열 필터', () => {
  beforeEach(() => navigation.reset('/calculator'));

  it('통화 KRW + 금액 ≥ 1000 → 1건, 상태로만(URL 미사용), "최근 100건" 안내', async () => {
    const ue = userEvent.setup();
    const modal = await openQuotes(ue);
    expect(within(modal).getByText('최근 100건 안에서 필터합니다')).toBeInTheDocument();
    await quickFilter(ue, '통화', check(ue, 'KRW'), modal);
    // 금액 = 슬라이더(숫자 입력 없음, §7.5) — 범위는 지금 목록(KRW 200~5,000)에서 계산, 하한 End = 실제 최대
    const dialog = await openField(ue, '금액', modal);
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    within(dialog).getByRole('slider', { name: '금액 최소' }).focus();
    await ue.keyboard('{End}');
    await waitFor(() => expect(firstCells('견적 목록 표')).toEqual(['Q-0001']));
    expect(screen.getByRole('dialog', { name: '금액 필터' })).toBeInTheDocument();
    await ue.keyboard('{Escape}');
    expect(activeFields()).toEqual(['금액: KRW ₩5,000 이상', '통화: KRW']);
    expect(within(modal).getByText('전체 4건 중 1건')).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('고정 필드 일자·제품·내용 + "＋ 3개 더"(견적 번호·금액·통화)', async () => {
    const ue = userEvent.setup();
    const modal = await openQuotes(ue);
    expect(
      within(modal)
        .getAllByRole('button', { name: / 필터$/ })
        .filter((b) => b.hasAttribute('data-quick-field'))
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['일자 필터', '제품 필터', '내용 필터']);
    await ue.click(within(modal).getByRole('button', { name: '＋ 3개 더' }));
    const picker = await screen.findByRole('dialog', { name: '필터 더 보기' });
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['견적 번호', '금액', '통화']);
  });

  it('금액 슬라이더: 통화 미지정이면 라디오 먼저 → 라디오 = 통화 즉시 → 범위(목록에서 계산) → 통화·금액 두 조건 (§7.5)', async () => {
    const ue = userEvent.setup();
    const modal = await openQuotes(ue);
    const dialog = await openField(ue, '금액', modal);
    expect(within(dialog).getByRole('slider', { name: '금액 최소' })).toBeDisabled();
    await ue.click(within(dialog).getByRole('radio', { name: 'KRW' }));
    expect(firstCells('견적 목록 표')).toEqual(['Q-0001', 'Q-0004']);
    const upper = within(dialog).getByRole('slider', { name: '금액 최대' });
    expect(upper).toHaveAttribute('aria-valuetext', '제한 없음');
    upper.focus();
    await ue.keyboard('{Home}');
    // 상한 칸 0 = 실제 최소(₩200)
    await waitFor(() => expect(firstCells('견적 목록 표')).toEqual(['Q-0004']));
    expect(upper).toHaveAttribute('aria-valuetext', '₩200');
    await ue.keyboard('{Escape}');
    expect(activeFields(modal)).toEqual(['금액: KRW ₩200 이하', '통화: KRW']);
    expect(within(modal).getByRole('button', { name: '＋ 1개 더' })).toBeInTheDocument();
  });

  it('정렬도 컴포넌트 상태 — URL 을 바꾸지 않는다 (page-state-memory §2.2-6 예외)', async () => {
    const ue = userEvent.setup();
    const modal = await openQuotes(ue);
    const th = within(within(modal).getByRole('table', { name: '견적 목록 표' })).getByRole(
      'columnheader',
      { name: '견적 번호' },
    );
    await ue.click(within(th).getByRole('button'));
    expect(th).toHaveAttribute('aria-sort', 'ascending');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.search()).toBe('');
  });

  it('제품 + 내용 텍스트 AND, 0건이면 빈 상태 → 필터 초기화', async () => {
    const ue = userEvent.setup();
    const modal = await openQuotes(ue);
    await quickFilter(ue, '제품', typeText(ue, 'd.amo'), modal);
    await quickFilter(ue, '내용', typeText(ue, '없는 내용'), modal);
    expect(within(modal).getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    await ue.click(
      within(screen.getByRole('table', { name: '견적 목록 표' })).getByRole('button', {
        name: '필터 초기화',
      }),
    );
    expect(firstCells('견적 목록 표')).toHaveLength(4);
  });

  it('모달 안에서 Esc → 팝오버만 닫히고 모달은 유지', async () => {
    const ue = userEvent.setup();
    const modal = await openQuotes(ue);
    // 고정 아닌 필드 — "＋ N개 더" → 견적 번호
    const dialog = await openField(ue, '견적 번호', modal);
    // 열리면 값 입력으로 포커스
    const input = within(dialog).getByRole('textbox', { name: '값' });
    await waitFor(() => expect(input).toHaveFocus());
    const modalKeydown = vi.fn();
    modal.addEventListener('keydown', modalKeydown);
    const keydown = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(keydown);
    });
    expect(keydown.defaultPrevented).toBe(true);
    expect(modalKeydown).not.toHaveBeenCalled();
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(modal, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '견적 번호 필터' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: '내 견적 목록' })).toHaveAttribute('open');
    // 포커스는 연 버튼("＋ N개 더")으로 돌아간다
    expect(within(modal).getByRole('button', { name: '＋ 3개 더' })).toHaveFocus();
  });
});
