import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { Drawer, Modal, Popover } from '@/components/ui';
import { BottomSheet } from '@/components/ui/sheet';
import {
  SHEET_MEDIA_QUERY,
  sheetUp,
  useScrollLock,
  useSheetLayout,
} from '@/components/ui/sheet-layout';

/**
 * 모바일 UI M0 하단 시트 (docs/specs/mobile-ui.md §3 BottomSheet·§5 M0): 모양은 `max-md:` CSS, JS 는 모션 분기(matchMedia —
 * 열렸을 때만, 서버 스냅샷 desktop)와 배경 스크롤 잠금뿐. jsdom 은 CSS 를 계산하지 않으므로 클래스·속성으로 단언한다.
 */
const withMotion = { wrapper: MotionProvider };

type Listener = (event: MediaQueryListEvent) => void;

/** matchMedia 목 — matches 값을 바꾸고 change 를 쏠 수 있다 */
function mockMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  const matchMedia = vi.fn((query: string) => {
    queries.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    } as unknown as MediaQueryList;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    queries,
    listeners,
    set(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-scroll-lock');
});

describe('useSheetLayout (모션 분기 전용)', () => {
  it('닫혀 있으면 matchMedia 를 보지 않고 false', () => {
    const media = mockMatchMedia(true);
    const { result } = renderHook(() => useSheetLayout(false));
    expect(result.current).toBe(false);
    expect(media.listeners.size).toBe(0);
  });

  it('열려 있으면 (width < 48rem) 를 구독하고 바뀌면 따라간다', () => {
    const media = mockMatchMedia(true);
    const { result, unmount } = renderHook(() => useSheetLayout(true));
    expect(result.current).toBe(true);
    expect(media.queries).toContain(SHEET_MEDIA_QUERY);
    act(() => media.set(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('matchMedia 가 없는 환경은 데스크톱(false)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useSheetLayout(true));
    expect(result.current).toBe(false);
  });

  it('시트 모션은 아래에서 위로', () => {
    expect(sheetUp.initial).toEqual({ y: '100%' });
    expect(sheetUp.animate).toMatchObject({ y: 0 });
    expect(sheetUp.exit).toMatchObject({ y: '100%' });
  });
});

describe('useScrollLock', () => {
  const locked = () => document.documentElement.hasAttribute('data-scroll-lock');

  it('여러 겹은 개수로 세고 마지막이 풀릴 때만 <html data-scroll-lock> 을 뗀다', () => {
    const outer = renderHook(({ on }) => useScrollLock(on), { initialProps: { on: true } });
    expect(locked()).toBe(true);
    const inner = renderHook(() => useScrollLock(true));
    outer.rerender({ on: false });
    expect(locked()).toBe(true);
    inner.unmount();
    expect(locked()).toBe(false);
    outer.unmount();
  });

  it('비활성은 아무것도 하지 않는다', () => {
    renderHook(() => useScrollLock(false));
    expect(locked()).toBe(false);
  });
});

describe('Modal · BottomSheet', () => {
  it('layout="auto"(기본)는 데스크톱 폭 클래스를 유지하고 시트 모양은 max-md: 에만', () => {
    render(
      <Modal open title="자동" onClose={() => {}} footer={<button type="button">저장</button>}>
        본문
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog', { name: '자동' });
    expect(dialog.className).toContain('w-[min(520px,calc(100vw-32px))]');
    expect(dialog.className).toContain('max-md:mt-auto');
    const footer = screen.getByRole('button', { name: '저장' }).parentElement!;
    expect(footer.className).toContain('max-md:pb-[calc(1rem+var(--safe-bottom))]');
    expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(true);
  });

  it('BottomSheet 은 폭과 상관없이 시트, fullScreen 은 max-md 전체 높이', () => {
    render(
      <BottomSheet open fullScreen title="시트" onClose={() => {}}>
        본문
      </BottomSheet>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog', { name: '시트' });
    expect(dialog.className).not.toContain('w-[min(520px');
    expect(dialog.className).toContain('mt-auto');
    expect(dialog.className).toContain('max-md:h-dvh');
    // 본문만 스크롤 + 푸터 없으면 본문 끝에 safe-area
    const body = screen.getByText('본문');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('overscroll-contain');
    expect(body.className).toContain('pb-[calc(1.25rem+var(--safe-bottom))]');
  });

  it('닫기 버튼은 보이는 32px + ::before 로 넓힌 터치 영역', async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="닫기 확인" onClose={onClose}>
        본문
      </BottomSheet>,
      withMotion,
    );
    const close = screen.getByRole('button', { name: '닫기' });
    expect(close.className).toContain('size-8');
    expect(close.className).toContain('before:-inset-1.5');
    await userEvent.click(close);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('모바일 폭에서 열리면 시트 모션을 쓴다(matchMedia 일치)', () => {
    mockMatchMedia(true);
    render(
      <Modal open title="모바일" onClose={() => {}}>
        본문
      </Modal>,
      withMotion,
    );
    expect(screen.getByRole('dialog', { name: '모바일' })).toBeInTheDocument();
  });
});

describe('Drawer', () => {
  it('max-md 에서 하단 시트 클래스(폭 전체·90dvh), 본문 overscroll-contain, 배경 잠금', () => {
    render(
      <Drawer open title="행 상세" onClose={() => {}}>
        상세 본문
      </Drawer>,
      withMotion,
    );
    const panel = screen.getByRole('dialog', { name: '행 상세' });
    expect(panel.className).toContain('max-md:max-h-[90dvh]');
    expect(panel.className).toContain('max-md:w-full!');
    expect(screen.getByText('상세 본문').className).toContain('overscroll-contain');
    expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(true);
  });
});

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} label="품목 필터">
        <input aria-label="값" />
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('max-md 시트: 배경 막·닫기 버튼(md:hidden) — 첫 포커스는 닫기 버튼이 아니라 입력, 닫기 버튼으로 닫힌다', async () => {
    render(<PopoverHarness />, withMotion);
    await userEvent.click(screen.getByRole('button', { name: '열기' }));
    const panel = screen.getByRole('dialog', { name: '품목 필터' });
    expect(panel.className).toContain('max-md:max-h-[90dvh]');
    expect(screen.getByTestId('popover-sheet-backdrop').className).toContain('md:hidden');
    await waitFor(() => expect(screen.getByRole('textbox', { name: '값' })).toHaveFocus());
    expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '품목 필터' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(false),
    );
  });
});
