import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_MAIN_ID, VIEW_SAVE_DEBOUNCE_MS } from '@/lib/page-state/keys';

/**
 * ViewStateTracker (page-state-memory §2.2-3·5, §2.3): URL 변경 500ms 디바운스 저장, 빈 쿼리 즉시 저장, 이탈 시 남은 저장 flush,
 * 스크롤은 이탈·visibilitychange 때 1회 저장(스크롤마다 저장 금지), 첫 마운트 다음 프레임에 1회 복원, 조건 변경 시 맨 위.
 */
const saves = vi.hoisted(() => ({
  query: vi.fn<(input: { pageKey: string; query: string }) => Promise<{ ok: boolean }>>(
    async () => ({ ok: true }),
  ),
  scroll: vi.fn<
    (input: { pageKey: string; query: string; top: number }) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true })),
}));
vi.mock('@/features/page-state/actions', () => ({
  saveViewStateAction: saves.query,
  saveViewScrollAction: saves.scroll,
}));
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);
const { navigation } = await import('../../helpers/next-navigation');
const { ViewStateTracker } = await import('@/features/page-state/ViewStateTracker');
const { navigateView } = await import('@/lib/page-state/view-navigation');
const { useUrlTableState } = await import('@/components/ui/data-table/useTableFilters');

let main: HTMLElement;

function setScroll(top: number) {
  main.scrollTop = top;
  main.dispatchEvent(new Event('scroll'));
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  saves.query.mockClear();
  saves.scroll.mockClear();
  navigation.reset('/pricing', '');
  window.history.replaceState(null, '', '/pricing');
  main = document.createElement('main');
  main.id = APP_MAIN_ID;
  document.body.append(main);
});

afterEach(() => {
  main.remove();
  setVisibility('visible');
  vi.useRealTimers();
});

const tracker = (props: Partial<Parameters<typeof ViewStateTracker>[0]> = {}) => (
  <ViewStateTracker pageKey="pricing" savedQuery="" restoreTop={null} {...props} />
);

describe('조회 쿼리 저장', () => {
  it('URL 이 바뀌면 500ms 뒤 1회 저장 (연속 변경은 마지막 값만)', () => {
    render(tracker());
    act(() => navigation.replace('/pricing?q=a'));
    act(() => vi.advanceTimersByTime(200));
    act(() => navigation.replace('/pricing?q=ab'));
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS - 1));
    expect(saves.query).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'pricing', query: 'q=ab' }]]);
  });

  it('명시 파라미터로 진입하면 그 쿼리를 저장한다 — 저장값과 같으면 다시 저장하지 않는다', () => {
    navigation.reset('/pricing', 'family=isign');
    const { unmount } = render(tracker({ savedQuery: 'q=old' }));
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS));
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'pricing', query: 'family=isign' }]]);
    unmount();
    saves.query.mockClear();
    render(tracker({ savedQuery: 'family=isign' }));
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS));
    expect(saves.query).not.toHaveBeenCalled();
  });

  it("'필터 초기화'(빈 쿼리)는 디바운스 없이 바로 빈 상태를 저장한다", () => {
    navigation.reset('/pricing', 'q=a&page=3');
    render(tracker({ savedQuery: 'q=a&page=3' }));
    act(() => navigation.replace('/pricing'));
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'pricing', query: '' }]]);
  });

  it('화면을 떠나면 남은 저장을 바로 보낸다', () => {
    const { unmount } = render(tracker());
    act(() => navigation.replace('/pricing?sort=price&dir=desc'));
    unmount();
    expect(saves.query.mock.calls).toEqual([
      [{ pageKey: 'pricing', query: 'sort=price&dir=desc' }],
    ]);
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS));
    expect(saves.query).toHaveBeenCalledTimes(1);
  });
});

describe('빈 상태 먼저 저장 (§6 — 사이드바 재클릭도 복원하므로)', () => {
  /** 저장 액션이 끝나지 않은 채로 두고, 테스트가 끝내는 시점을 정한다 */
  function holdSave() {
    let release!: () => void;
    saves.query.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ ok: true }))),
    );
    return () => act(async () => release());
  }

  it('빈 쿼리로 가는 화면 안 이동은 빈 상태 저장이 끝난 뒤에 이동하고, 이동 뒤 다시 저장하지 않는다', async () => {
    navigation.reset('/pricing', 'q=a');
    render(tracker({ savedQuery: 'q=a' }));
    const release = holdSave();
    act(() => navigateView('/pricing', navigation.replace));
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'pricing', query: '' }]]);
    expect(navigation.replace).not.toHaveBeenCalled();
    await release();
    expect(navigation.replace).toHaveBeenCalledWith('/pricing');
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS));
    expect(saves.query).toHaveBeenCalledTimes(1);
  });

  it('대기 중인 디바운스 저장(이전 조건)은 취소된다 — 빈 상태 뒤에 덮어쓰지 않게', async () => {
    navigation.reset('/pricing', 'q=a');
    render(tracker({ savedQuery: 'q=a' }));
    act(() => navigation.replace('/pricing?q=b'));
    await act(async () => navigateView('/pricing', navigation.replace));
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS * 2));
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'pricing', query: '' }]]);
    expect(navigation.search()).toBe('');
  });

  it('비어 있지 않은 이동은 기다리지 않고 바로 이동하고, 저장은 그대로 디바운스', () => {
    navigation.reset('/pricing', 'q=a');
    render(tracker({ savedQuery: 'q=a' }));
    act(() => navigateView('/pricing?q=c', navigation.replace));
    expect(navigation.replace).toHaveBeenCalledWith('/pricing?q=c');
    expect(saves.query).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS));
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'pricing', query: 'q=c' }]]);
  });

  it("'필터 초기화'(useUrlTableState.reset)도 빈 상태 저장을 기다린 뒤 router.replace", async () => {
    navigation.reset('/admin/users', 'f.name.has=kim&sort=name&dir=asc');
    render(tracker({ pageKey: 'admin-users', savedQuery: 'f.name.has=kim&sort=name&dir=asc' }));
    const { result } = renderHook(() => useUrlTableState({}, ['name']));
    const release = holdSave();
    act(() => result.current.reset());
    expect(saves.query.mock.calls).toEqual([[{ pageKey: 'admin-users', query: '' }]]);
    expect(navigation.replace).not.toHaveBeenCalled();
    await release();
    expect(navigation.replace).toHaveBeenCalledWith('/admin/users', { scroll: false });
  });

  it('트래커가 없는(떠난) 화면으로의 이동은 기다리지 않는다', () => {
    const { unmount } = render(tracker({ savedQuery: 'q=a' }));
    unmount();
    saves.query.mockClear();
    act(() => navigateView('/pricing', navigation.replace));
    expect(navigation.replace).toHaveBeenCalledWith('/pricing');
    expect(saves.query).not.toHaveBeenCalled();
  });
});

describe('저장 행 없음', () => {
  it('첫 방문(저장 행 없음)의 빈 쿼리는 저장하지 않는다', () => {
    render(tracker({ savedQuery: null }));
    act(() => vi.advanceTimersByTime(VIEW_SAVE_DEBOUNCE_MS));
    expect(saves.query).not.toHaveBeenCalled();
  });
});

describe('스크롤', () => {
  it('첫 마운트 다음 프레임에 restoreTop 으로 1회 복원', () => {
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 5000 });
    const { rerender } = render(tracker({ restoreTop: 640 }));
    expect(main.scrollTop).toBe(0);
    act(() => vi.advanceTimersToNextFrame());
    expect(main.scrollTop).toBe(640);
    // 이후 props 가 바뀌어도(같은 화면 안 RSC 갱신) 다시 복원하지 않는다
    setScroll(100);
    rerender(tracker({ restoreTop: 900 }));
    act(() => vi.advanceTimersToNextFrame());
    expect(main.scrollTop).toBe(100);
  });

  it('조건이 다르면(restoreTop null) 맨 위', () => {
    main.scrollTop = 300;
    render(tracker({ restoreTop: null }));
    act(() => vi.advanceTimersToNextFrame());
    expect(main.scrollTop).toBe(0);
  });

  it('필터·정렬·페이지가 바뀌면 맨 위로', () => {
    render(tracker());
    act(() => vi.advanceTimersToNextFrame());
    setScroll(800);
    act(() => navigation.replace('/pricing?page=2'));
    expect(main.scrollTop).toBe(0);
  });

  it('스크롤 중에는 저장하지 않고, visibilitychange(hidden)·이탈 때 {query, top} 을 1회 저장', () => {
    navigation.reset('/pricing', 'q=a');
    const { unmount } = render(tracker({ savedQuery: 'q=a' }));
    act(() => vi.advanceTimersToNextFrame());
    for (const top of [10, 200, 450]) setScroll(top);
    expect(saves.scroll).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(saves.scroll.mock.calls).toEqual([[{ pageKey: 'pricing', query: 'q=a', top: 450 }]]);
    // 같은 위치·조건이면 이탈 때 다시 보내지 않는다
    setVisibility('visible');
    unmount();
    expect(saves.scroll).toHaveBeenCalledTimes(1);
  });

  it('다른 화면으로 이동이 커밋된 뒤의 스크롤 이벤트는 이 화면 위치로 기억하지 않는다', () => {
    const { unmount } = render(tracker());
    act(() => vi.advanceTimersToNextFrame());
    setScroll(520);
    window.history.replaceState(null, '', '/calculator');
    setScroll(0);
    unmount();
    expect(saves.scroll.mock.calls).toEqual([[{ pageKey: 'pricing', query: '', top: 520 }]]);
  });
});
