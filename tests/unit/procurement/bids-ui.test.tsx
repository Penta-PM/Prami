import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BidFilterBar } from '@/features/procurement/bids/BidFilterBar';
import { BidTable, type BidTableRow } from '@/features/procurement/bids/BidTable';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { DEFAULT_BID_FILTER, type BidFilter } from '@/lib/procurement/bid-filter';
import { BID_FIT_HINT_LINES, BID_FIT_HINT_NAME } from '@/lib/procurement/copy';

/**
 * 조달이 통합 UI-3 — 입찰 공고 필터 바·표 (합성 데이터, 링크는 example.invalid).
 * - 칩·토글·정렬·상만 → URL(router.replace, 1페이지로)
 * - 적합도 배지 = 글자 + 점수, 공고명 링크 = 새 탭 + rel noopener noreferrer + 외부 링크 아이콘, 행 클릭은 아무것도 열지 않는다
 * - 근거 펼침(aria-expanded·표 안 행), D-day 배지(임박·마감·미표기), 예산·추정가 억·만, 마감 공고 표시
 */
const nav = vi.hoisted(() => ({ replace: [] as string[], push: [] as string[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (href: string) => nav.replace.push(href),
    push: (href: string) => nav.push.push(href),
    refresh: vi.fn(),
  }),
  usePathname: () => '/procurement/bids',
  useSearchParams: () => new URLSearchParams(),
}));

const COUNTS = [
  { product: 'WAPPLES' as const, count: 4 },
  { product: 'D.AMO' as const, count: 2 },
  { product: 'iSIGN' as const, count: 1 },
];

function renderBar(filter: Partial<BidFilter> = {}) {
  return render(
    <BidFilterBar
      filter={{ ...DEFAULT_BID_FILTER, ...filter }}
      productCounts={COUNTS}
      allCount={7}
    />,
  );
}

function row(overrides: Partial<BidTableRow> = {}): BidTableRow {
  return {
    bidNo: 'T-0001',
    bidOrd: '000',
    title: '가상 기관 웹방화벽 도입 사업',
    products: ['WAPPLES'],
    orderOrg: '가상 발주처',
    demandOrg: '가상 수요기관',
    postedAt: new Date('2026-10-20T01:00:00Z'),
    deadlineAt: new Date('2026-11-10T08:00:00Z'),
    budget: 1_234_000_000,
    estPrice: 45_670_000,
    detailUrl: 'https://example.invalid/bids/T-0001',
    fitGrade: '상',
    fitScore: 87,
    fitReasons: ['＋ 공고명에 제품 키워드', '＋ 예산 충분', '－ 용역 공고'],
    closed: false,
    daysLeft: 14,
    ...overrides,
  };
}

beforeEach(() => {
  nav.replace.length = 0;
  nav.push.length = 0;
});

describe('BidFilterBar — URL 이 상태', () => {
  it('제품 칩: 전체 + 제품별 건수, 현재 선택은 aria-pressed', () => {
    renderBar({ product: 'D.AMO' });
    const chips = within(screen.getByRole('group', { name: '제품' })).getAllByRole('button');
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      '전체 7건',
      'WAPPLES 4건',
      'D.AMO 2건',
      'iSIGN 1건',
    ]);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      '전체7',
      'WAPPLES4',
      'D.AMO2',
      'iSIGN1',
    ]);
    expect(screen.getByRole('button', { name: 'D.AMO 2건' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '전체 7건' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('칩을 누르면 product 를 replace 하고 1페이지로, 전체는 product 를 지운다', async () => {
    const { unmount } = renderBar({ page: 3, sort: 'posted' });
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES 4건' }));
    expect(nav.replace).toEqual(['/procurement/bids?product=WAPPLES&sort=posted']);
    unmount();
    renderBar({ product: 'iSIGN', page: 2 });
    await userEvent.click(screen.getByRole('button', { name: '전체 7건' }));
    expect(nav.replace.at(-1)).toBe('/procurement/bids');
    expect(nav.push).toEqual([]);
  });

  it('빠른 연속 조작(URL 반영 전): 두 번째 변경은 첫 변경 결과에서 계산 — 첫 변경이 사라지지 않는다 (R1)', async () => {
    // URL(props) 은 그대로 product=iSIGN·마감 포함 — router.replace 는 기록만 하고 반영하지 않는다
    renderBar({ product: 'iSIGN', includeClosed: true });
    await userEvent.click(screen.getByRole('button', { name: '전체 7건' }));
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: '정렬' })).getByRole('radio', {
        name: '게시순',
      }),
    );
    expect(nav.replace).toEqual([
      '/procurement/bids?closed=1',
      '/procurement/bids?closed=1&sort=posted',
    ]);
  });

  it('이미 선택된 칩을 다시 눌러도 이동하지 않는다', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: '전체 7건' }));
    expect(nav.replace).toEqual([]);
  });

  it('진행 중 / 마감 포함 (Segmented)', async () => {
    renderBar();
    const group = screen.getByRole('radiogroup', { name: '마감 여부' });
    expect(within(group).getByRole('radio', { name: '진행 중' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: '마감 포함' }));
    expect(nav.replace).toEqual(['/procurement/bids?closed=1']);
  });

  it('적합도순 / 게시순 (Segmented)', async () => {
    renderBar({ includeClosed: true });
    const group = screen.getByRole('radiogroup', { name: '정렬' });
    expect(within(group).getByRole('radio', { name: '적합도순' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: '게시순' }));
    expect(nav.replace).toEqual(['/procurement/bids?closed=1&sort=posted']);
  });

  it('상만 토글: 켜고 끈다', async () => {
    const { unmount } = renderBar({ page: 4 });
    const toggle = screen.getByRole('button', { name: '상만' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(nav.replace).toEqual(['/procurement/bids?top=1']);
    unmount();
    renderBar({ topGradeOnly: true, product: 'WAPPLES' });
    expect(screen.getByRole('button', { name: '상만' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '상만' }));
    expect(nav.replace.at(-1)).toBe('/procurement/bids?product=WAPPLES');
  });
});

describe('BidTable', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => {
    openSpy.mockRestore();
  });

  it('적합도 배지 = 등급 글자 + 점수 (색만으로 구분하지 않음)', () => {
    render(
      <BidTable
        rows={[
          row(),
          row({ bidNo: 'T-0002', fitGrade: '중', fitScore: 55 }),
          row({ bidNo: 'T-0003', fitGrade: null, fitScore: null, fitReasons: [] }),
        ]}
      />,
    );
    const [, first, second, third] = screen.getAllByRole('row');
    expect(within(first!).getByText('적합도 상, 87점')).toBeInTheDocument();
    expect(within(first!).getByText('상')).toBeVisible();
    expect(within(first!).getByText('87점')).toBeVisible();
    expect(within(second!).getByText('중')).toBeInTheDocument();
    expect(within(second!).getByText('55점')).toBeInTheDocument();
    expect(within(third!).getByText('적합도 없음')).toBeInTheDocument();
  });

  it('공고명 링크: 새 탭 + rel=noopener noreferrer + 외부 링크 아이콘, http(s) 가 아니면 글자만', () => {
    render(
      <BidTable
        rows={[
          row(),
          row({ bidNo: 'T-0002', title: '스킴이 이상한 공고', detailUrl: 'javascript:alert(1)' }),
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: /가상 기관 웹방화벽 도입 사업/ });
    expect(link).toHaveAttribute('href', 'https://example.invalid/bids/T-0001');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(/새 창에서 공고 열기/);
    expect(link.querySelector('svg[data-icon="external-link"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /스킴이 이상한 공고/ })).toBeNull();
    expect(screen.getByText('스킴이 이상한 공고')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('행(링크 밖) 클릭은 새 창을 열지 않고 이동도 하지 않는다', async () => {
    render(<BidTable rows={[row()]} />);
    const dataRow = screen.getAllByRole('row')[1]!;
    expect(dataRow).not.toHaveAttribute('onclick');
    await userEvent.click(within(dataRow).getByText('가상 수요기관'));
    await userEvent.click(dataRow);
    fireEvent.click(within(dataRow).getAllByRole('cell')[0]!);
    expect(openSpy).not.toHaveBeenCalled();
    expect(nav.push).toEqual([]);
    expect(nav.replace).toEqual([]);
    // 근거 펼침 행도 생기지 않는다(펼침은 버튼으로만)
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('근거 ＋/－ 를 표 안에서 펼치고 접는다', async () => {
    render(<BidTable rows={[row()]} />);
    const button = screen.getByRole('button', { name: /근거 보기/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('＋2 －1');
    expect(screen.queryByRole('list')).toBeNull();

    await userEvent.click(button);
    const opened = screen.getByRole('button', { name: /근거 접기/ });
    expect(opened).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: '가상 기관 웹방화벽 도입 사업 적합도 근거' });
    // 펼침 목록은 표 안의 행(aria-controls 대상)
    expect(list.closest('tr')).toHaveAttribute('id', opened.getAttribute('aria-controls'));
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '＋가점: 공고명에 제품 키워드',
      '＋가점: 예산 충분',
      '－감점: 용역 공고',
    ]);

    await userEvent.click(opened);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: /근거 보기/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('근거가 없으면 펼침 버튼이 없다', () => {
    render(<BidTable rows={[row({ fitReasons: [] })]} />);
    expect(screen.queryByRole('button', { name: /근거/ })).toBeNull();
  });

  it('마감 D-day 배지: 임박·오늘 마감·D-n·마감·미표기, 마감 공고는 행에 표시', () => {
    render(
      <BidTable
        rows={[
          row({ bidNo: 'A', daysLeft: 2 }),
          row({ bidNo: 'B', daysLeft: 0 }),
          row({ bidNo: 'C', daysLeft: 14 }),
          row({ bidNo: 'D', closed: true, daysLeft: -3, deadlineAt: new Date('2026-10-01') }),
          row({ bidNo: 'E', deadlineAt: null, daysLeft: null }),
        ]}
      />,
    );
    const badges = screen.getAllByTestId('bid-deadline-badge');
    expect(badges.map((badge) => [badge.textContent, badge.dataset.tone])).toEqual([
      ['D-2 임박', 'urgent'],
      ['오늘 마감', 'urgent'],
      ['D-14', 'open'],
      ['마감', 'closed'],
      ['마감일 미표기', 'none'],
    ]);
    expect(badges[0]).toHaveClass('bg-accent-orange', 'text-text-primary');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.dataset.closed ?? null)).toEqual([null, null, null, 'true', null]);
  });

  it('예산·추정가는 억·만, 없으면 —', () => {
    render(
      <BidTable rows={[row(), row({ bidNo: 'T-0002', budget: null, estPrice: 300_000_000 })]} />,
    );
    const [, first, second] = screen.getAllByRole('row');
    expect(within(first!).getByText('12억 3,400만')).toBeInTheDocument();
    expect(within(first!).getByText('4,567만')).toBeInTheDocument();
    expect(within(second!).getByText('—')).toBeInTheDocument();
    expect(within(second!).getByText('3억')).toBeInTheDocument();
  });

  it('공고일·마감 시각은 KST, 표는 래퍼 안에서만 가로 스크롤', () => {
    const { container } = render(<BidTable rows={[row()]} />);
    expect(screen.getByText('2026-10-20')).toBeInTheDocument();
    expect(screen.getByText('2026-11-10 17:00')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '입찰 공고 목록' });
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(container.firstElementChild).toBe(table.parentElement);
  });
});

describe('BidTable 적합도 기준 툴팁 (UX PR-U1 §3)', () => {
  const withMotion = { wrapper: MotionProvider };
  const hint = () => screen.getByRole('button', { name: '적합도 기준' });

  it('문구 상수: 요인·등급 구간 4줄, 근거 칸 이름은 표의 실제 칸 이름', () => {
    expect(BID_FIT_HINT_NAME).toBe('적합도 기준');
    expect(BID_FIT_HINT_LINES).toEqual([
      '공고명·업무구분·예산·마감·수요기관 납품 이력으로 0~100점을 매깁니다. 70점 이상 상, 45점 이상 중, 그 아래 하.',
      '가점: 제품 구매·구축 사업, 물품 공고, 자사·경쟁사 제품 납품 이력이 있는 기관, 큰 예산, 재공고.',
      '감점: 연구·평가·점검·컨설팅 용역, 개발 사업, 소액, 마감 3일 이내.',
      "공고별 근거는 '근거' 칸에서 확인하세요.",
    ]);
    render(<BidTable rows={[row()]} />, withMotion);
    expect(screen.getByRole('columnheader', { name: /^근거$/ })).toBeInTheDocument();
  });

  it("'적합도' 머리 안에 트리거 하나 — 클릭으로 열면 4줄 문구, 바깥 클릭으로 닫힘", async () => {
    render(
      <>
        <BidTable rows={[row()]} />
        <p>빈 곳</p>
      </>,
      withMotion,
    );
    const header = screen.getAllByRole('columnheader')[0]!;
    expect(header).toHaveTextContent('적합도');
    expect(within(header).getByRole('button', { name: '적합도 기준' })).toBe(hint());
    expect(hint()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(hint());
    const dialog = screen.getByRole('dialog', { name: '적합도 기준' });
    expect(hint()).toHaveAttribute('aria-expanded', 'true');
    for (const line of BID_FIT_HINT_LINES)
      expect(within(dialog).getByText(line)).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(BID_FIT_HINT_LINES.join(''));

    await userEvent.click(screen.getByText('빈 곳'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('키보드: Enter 로 열고 Esc 로 닫으면 트리거로 포커스 복귀', async () => {
    render(<BidTable rows={[row()]} />, withMotion);
    hint().focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('dialog', { name: '적합도 기준' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hint()).toHaveFocus();
  });
});
