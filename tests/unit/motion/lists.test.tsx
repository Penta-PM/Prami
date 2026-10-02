import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { CartPanel } from '@/features/calculator/CartPanel';
import { StepCategory } from '@/features/calculator/QuoteSteps';
import type { CartLine, CategoryChipsView } from '@/features/calculator/types';
import type { SolutionGroupView } from '@/features/groups/types';
import { PartsEditor } from '@/features/parts/PartsEditor';
import type { CatalogItemView } from '@/features/parts/types';

/**
 * Motion 도입 PR-4B 클라이언트 목록 (스펙 §3.3 "클라이언트 목록 추가·삭제" P2, "GroupsManager 그룹 목록" P3).
 * ① 첫 렌더 항목에 숨김 스타일 없음(Presence initial={false}) ② 추가 시 새 항목만 진입 ③ 삭제 시 퇴장 후 DOM 에서 제거.
 * tests/setup.ts 가 skipAnimations=true 를 깔아 두므로 기본 describe 의 사라짐은 waitFor 로 단언하고,
 * 실제 퇴장·진입 시간은 "실제 애니메이션" describe 에서만 skipAnimations 를 끄고 본다.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/groups',
}));
vi.mock('@/features/groups/actions', () => ({
  upsertSolutionGroupAction: vi.fn(),
  deleteSolutionGroupAction: vi.fn(),
}));
const { GroupsManager } = await import('@/features/groups/GroupsManager');

const withMotion = { wrapper: MotionProvider };
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** 숨김 initial(opacity 0 · height 0 · scale 0.96)이 인라인 스타일로 남아 있지 않다 */
function expectVisible(element: HTMLElement) {
  expect(element.style.opacity === '' || element.style.opacity === '1').toBe(true);
  expect(element.style.height).not.toBe('0px');
  expect(element.style.transform).not.toMatch(/scale\(0\.96\)/);
}

function line(id: string, name: string): CartLine {
  return {
    id,
    kind: 'item',
    itemCode: id,
    name,
    priceType: '소비자가',
    qty: 1,
    unitPrice: 1000,
    currency: 'KRW',
    parts: [],
    bundles: [],
    groupItems: [],
    discountRate: 0,
    preDiscount: 1000,
    lineTotal: 1000,
  };
}

function CartHarness({ initial }: { initial: CartLine[] }) {
  const [lines, setLines] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setLines((prev) => [...prev, line('c', '품목 C')])}>
        담기
      </button>
      <CartPanel
        lines={lines}
        saved={[]}
        isPending={false}
        activeQuote={null}
        onRemove={(id) => setLines((prev) => prev.filter((entry) => entry.id !== id))}
        onReset={() => setLines([])}
        onSave={() => undefined}
        onReload={() => undefined}
        onDelete={() => undefined}
        onShare={() => undefined}
      />
    </>
  );
}

const cartItem = (name: string) =>
  within(screen.getByRole('region', { name: '장바구니' }))
    .getByText(name)
    .closest('li') as HTMLElement;
const cartList = () =>
  within(screen.getByRole('region', { name: '장바구니' })).getByRole('list') as HTMLElement;

const PARTS: CatalogItemView[] = [
  { itemCode: 'P1', itemName: '파츠 하나' },
  { itemCode: 'P2', itemName: '파츠 둘' },
  { itemCode: 'P3', itemName: '파츠 셋' },
];

function PartsHarness() {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(['P1', 'P2']));
  return (
    <PartsEditor
      models={[{ itemCode: 'M1', itemName: '모델 하나' }]}
      parts={PARTS}
      mappedModels={new Set()}
      selectedModel="M1"
      checked={checked}
      editing={false}
      isPending={false}
      onSelectModel={() => undefined}
      onToggle={(code, on) =>
        setChecked((prev) => {
          const next = new Set(prev);
          if (on) next.add(code);
          else next.delete(code);
          return next;
        })
      }
      onCancel={() => undefined}
      onSave={() => undefined}
    />
  );
}

const selectedChip = (name: string) =>
  within(screen.getByLabelText('선택된 파츠')).queryByText(name) as HTMLElement | null;

const CHIPS: CategoryChipsView = {
  majors: ['WAPPLES'],
  mids: ['어플라이언스', '파츠'],
  minors: [],
  hasMaster: true,
};

function categoryProps(chips: CategoryChipsView) {
  return { chips, mid: null, minor: null, onMid: () => undefined, onMinor: () => undefined };
}
const chipWrapper = (name: string) =>
  screen.queryByRole('button', { name })?.parentElement as HTMLElement | undefined;

function group(id: string, name: string): SolutionGroupView {
  return { id, productFamily: 'WAPPLES', name, items: [] };
}
const groupCard = (name: string) =>
  (within(screen.getByRole('list', { name: '솔루션 그룹 목록' }))
    .queryByRole('heading', { name })
    ?.closest('li') ?? null) as HTMLElement | null;

describe('CartPanel 장바구니 lines (Motion 도입 스펙 §3.3 클라이언트 목록)', () => {
  it('첫 렌더(복원된 장바구니) 항목은 숨김 스타일 없이 보이고, 접힘용 shrink-0·overflow-hidden 을 가진다', () => {
    render(<CartHarness initial={[line('a', '품목 A'), line('b', '품목 B')]} />, withMotion);
    for (const name of ['품목 A', '품목 B']) {
      const item = cartItem(name);
      expectVisible(item);
      expect(item).toHaveClass('shrink-0', 'overflow-hidden');
    }
  });

  it('추가·삭제: 새 항목이 생기고, 삭제한 항목만 DOM 에서 제거되며 나머지는 유지된다', async () => {
    render(<CartHarness initial={[line('a', '품목 A'), line('b', '품목 B')]} />, withMotion);
    await userEvent.click(screen.getByRole('button', { name: '담기' }));
    expect(cartItem('품목 C')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '품목 A 삭제' }));
    await waitFor(() => expect(screen.queryByText('품목 A')).not.toBeInTheDocument());
    expect(within(cartList()).getAllByRole('listitem')).toHaveLength(2);
    expectVisible(cartItem('품목 B'));
  });

  it('"담긴 품목이 없습니다" 안내는 모션 대상이 아니다 (일반 li)', () => {
    render(<CartHarness initial={[]} />, withMotion);
    const empty = screen.getByText('담긴 품목이 없습니다.');
    expect(empty).not.toHaveClass('overflow-hidden');
    expect(empty.getAttribute('style')).toBeNull();
  });
});

describe('PartsEditor 선택 칩 (Motion 도입 스펙 §3.3 클라이언트 목록)', () => {
  it('모델 선택 시 이미 체크된 칩은 숨김 없이 보이고, 해제한 칩만 사라진다', async () => {
    render(<PartsHarness />, withMotion);
    expectVisible(selectedChip('파츠 하나')!);
    expectVisible(selectedChip('파츠 둘')!);
    await userEvent.click(screen.getByRole('checkbox', { name: /파츠 셋/ }));
    expect(selectedChip('파츠 셋')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '파츠 하나 선택 해제' }));
    await waitFor(() => expect(selectedChip('파츠 하나')).not.toBeInTheDocument());
    expect(selectedChip('파츠 둘')).toBeInTheDocument();
    expect(selectedChip('파츠 셋')).toBeInTheDocument();
  });
});

describe('QuoteSteps 중·소분류 칩 (Motion 도입 스펙 §3.3 클라이언트 목록)', () => {
  it('첫 렌더 칩은 숨김 없이 보이고, 대분류(활성 표시) 칩은 감싸지 않는다', () => {
    render(<StepCategory {...categoryProps(CHIPS)} />, withMotion);
    expectVisible(chipWrapper('어플라이언스')!);
    expect(chipWrapper('WAPPLES')).toHaveAttribute('role', 'group');
  });

  it('제품군이 바뀌어 칩 목록이 바뀌면 빠진 칩은 제거되고 남은 칩은 유지된다', async () => {
    const { rerender } = render(<StepCategory {...categoryProps(CHIPS)} />, withMotion);
    rerender(<StepCategory {...categoryProps({ ...CHIPS, mids: ['파츠', '라이선스'] })} />);
    expect(screen.getByRole('button', { name: '라이선스' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '어플라이언스' })).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('group', { name: '중분류' })).getAllByRole('button'),
    ).toHaveLength(2);
  });
});

describe('GroupsManager 그룹 목록 (Motion 도입 스펙 §3.3 P3 — fade 만)', () => {
  it('서버 렌더 HTML 의 기존 카드에 숨김 initial(opacity:0)이 없다', () => {
    const html = renderToString(
      <MotionProvider>
        <GroupsManager family="WAPPLES" groups={[group('g1', '그룹 하나')]} candidates={[]} />
      </MotionProvider>,
    );
    expect(html).toContain('그룹 하나');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });

  it('신규 카드가 생기고 삭제된 카드만 제거된다. height 없이 fade + layout 재배치 (Plan §9.4 Q2)', async () => {
    const { rerender } = render(
      <GroupsManager family="WAPPLES" groups={[group('g1', '그룹 하나')]} candidates={[]} />,
      withMotion,
    );
    expectVisible(groupCard('그룹 하나')!);
    rerender(
      <GroupsManager
        family="WAPPLES"
        groups={[group('g1', '그룹 하나'), group('g2', '그룹 둘')]}
        candidates={[]}
      />,
    );
    expect(groupCard('그룹 둘')).toBeInTheDocument();
    rerender(<GroupsManager family="WAPPLES" groups={[group('g2', '그룹 둘')]} candidates={[]} />);
    await waitFor(() => expect(groupCard('그룹 하나')).toBeNull());
    expect(groupCard('그룹 둘')).toBeInTheDocument();
    expect(groupCard('그룹 둘')).not.toHaveClass('overflow-hidden');
  });
});

/**
 * 실제 애니메이션 경로: setup.ts 의 skipAnimations 를 끄고 퇴장(exit 160ms) 동안 항목이 DOM 에 남았다가 제거되는지,
 * 추가 시 새 항목만 initial(숨김)에서 시작하는지 본다.
 */
describe('클라이언트 목록 — 실제 애니메이션 (skipAnimations 끔)', () => {
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
  });
  afterEach(() => {
    MotionGlobalConfig.skipAnimations = true;
  });

  it('CartPanel: 추가한 항목만 숨김에서 진입하고, 삭제 항목은 퇴장 동안 남았다가 제거된다', async () => {
    render(<CartHarness initial={[line('a', '품목 A'), line('b', '품목 B')]} />, withMotion);
    await userEvent.click(screen.getByRole('button', { name: '담기' }));
    // 진입 시작: 새 항목은 initial(opacity 0 · height 0)에서 시작, 기존 항목은 그대로
    expect(Number(cartItem('품목 C').style.opacity)).toBeLessThan(1);
    expectVisible(cartItem('품목 A'));
    expectVisible(cartItem('품목 B'));
    await waitFor(() => expect(cartItem('품목 C').style.opacity).toBe('1'), { timeout: 1000 });

    await userEvent.click(screen.getByRole('button', { name: '품목 A 삭제' }));
    await wait(60);
    expect(screen.getByText('품목 A')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('품목 A')).not.toBeInTheDocument(), {
      timeout: 1000,
    });
    expect(cartItem('품목 B')).toBeInTheDocument();
    expect(cartItem('품목 C')).toBeInTheDocument();
  });

  it('PartsEditor: 해제한 칩은 퇴장 동안 남았다가 제거된다', async () => {
    render(<PartsHarness />, withMotion);
    await userEvent.click(screen.getByRole('button', { name: '파츠 하나 선택 해제' }));
    await wait(60);
    expect(selectedChip('파츠 하나')).toBeInTheDocument();
    await waitFor(() => expect(selectedChip('파츠 하나')).not.toBeInTheDocument(), {
      timeout: 1000,
    });
    expect(selectedChip('파츠 둘')).toBeInTheDocument();
  });

  it('GroupsManager: 퇴장 중에는 아래 카드가 점프하지 않고, 제거 순간 layout 으로 미끄러져 올라온다 (Plan §9.4 Q2)', async () => {
    // jsdom 은 레이아웃을 계산하지 않으므로 카드 위치를 흉내 낸다 — 그룹 하나(높이 100)가 DOM 에 있는 동안 그룹 둘은 top 114
    // (gap-3.5 = 14px), 제거된 뒤에는 top 0. Motion layout 은 이 차이를 transform 으로 보정하며 0.28s 동안 미끄러뜨린다.
    const rect = (top: number) =>
      ({
        top,
        bottom: top + 100,
        left: 0,
        right: 300,
        width: 300,
        height: 100,
        x: 0,
        y: top,
      }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName !== 'LI') return rect(0);
        if (this.textContent?.includes('그룹 둘')) return rect(groupCard('그룹 하나') ? 114 : 0);
        return rect(0);
      });
    try {
      const { rerender } = render(
        <GroupsManager
          family="WAPPLES"
          groups={[group('g1', '그룹 하나'), group('g2', '그룹 둘')]}
          candidates={[]}
        />,
        withMotion,
      );
      rerender(
        <GroupsManager family="WAPPLES" groups={[group('g2', '그룹 둘')]} candidates={[]} />,
      );
      await wait(60);
      // 퇴장 중: 삭제 카드가 자리를 지키고 있어 그룹 둘은 이동(transform) 없이 제자리
      expect(groupCard('그룹 하나')).toBeInTheDocument();
      expect(groupCard('그룹 둘')!.style.transform).toMatch(/^(none)?$/);
      // 제거 순간: 그룹 둘이 이전 위치(+114px)에서 출발하는 transform 이 걸린다 = 한 번에 튀지 않음
      await waitFor(() => expect(groupCard('그룹 하나')).toBeNull(), { timeout: 1000 });
      await waitFor(
        () => expect(groupCard('그룹 둘')!.style.transform).toMatch(/translate3d\(0px, [1-9]/),
        {
          timeout: 1000,
        },
      );
      // 재배치가 끝나면 transform 이 풀린다
      await waitFor(() => expect(groupCard('그룹 둘')!.style.transform).toMatch(/^(none)?$/), {
        timeout: 1000,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('GroupsManager: 삭제된 카드는 fade 퇴장 동안 남았다가 제거되고, 신규 카드만 opacity 0 에서 진입한다', async () => {
    const { rerender } = render(
      <GroupsManager family="WAPPLES" groups={[group('g1', '그룹 하나')]} candidates={[]} />,
      withMotion,
    );
    rerender(
      <GroupsManager
        family="WAPPLES"
        groups={[group('g1', '그룹 하나'), group('g2', '그룹 둘')]}
        candidates={[]}
      />,
    );
    expect(Number(groupCard('그룹 둘')!.style.opacity)).toBeLessThan(1);
    expectVisible(groupCard('그룹 하나')!);
    expect(groupCard('그룹 둘')!.style.height).toBe('');

    rerender(<GroupsManager family="WAPPLES" groups={[group('g2', '그룹 둘')]} candidates={[]} />);
    await wait(60);
    expect(groupCard('그룹 하나')).toBeInTheDocument();
    await waitFor(() => expect(groupCard('그룹 하나')).toBeNull(), { timeout: 1000 });
    expect(groupCard('그룹 둘')).toBeInTheDocument();
  });
});
