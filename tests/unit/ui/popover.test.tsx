import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { Modal, Popover } from '@/components/ui';

/**
 * 팝오버 프리미티브 (표 열 필터 스펙 §2.5-5): 비모달 dialog·첫 입력 포커스·Esc(모달 안에서도 팝오버만)·바깥 클릭·Tab 이탈·폭.
 * tests/setup.ts 의 skipAnimations 로 퇴장은 다음 프레임에 끝난다 — 사라짐은 waitFor 로 기다린다.
 */
const withMotion = { wrapper: MotionProvider };

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        필터
      </button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        anchorRef={triggerRef}
        label="품목명 필터"
      >
        <button type="button">연산자</button>
        <input aria-label="값" />
        <button type="button">적용</button>
      </Popover>
      <button type="button">바깥</button>
      <button type="button" disabled>
        비활성
      </button>
      <p>빈 곳</p>
    </div>
  );
}

function ModalHarness({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="내 견적">
      <Harness />
    </Modal>
  );
}

const trigger = () => screen.getByRole('button', { name: '필터' });

describe('Popover (표 열 필터 스펙 §2.5-5)', () => {
  it('닫혀 있으면 아무것도 렌더하지 않는다', () => {
    render(<Harness />, withMotion);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('열면 비모달 dialog + aria-label, 첫 입력으로 포커스, 폭·z 클래스', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    const dialog = screen.getByRole('dialog', { name: '품목명 필터' });
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveClass('w-[min(320px,calc(100vw-32px))]', 'fixed', 'z-40');
    // 버튼이 먼저 있어도 입력이 우선
    await waitFor(() => expect(screen.getByRole('textbox', { name: '값' })).toHaveFocus());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('위치: 트리거 아래, 화면 밖으로 넘치지 않게 가로 고정', async () => {
    render(<Harness />, withMotion);
    const rect = {
      top: 100,
      bottom: 130,
      left: 980,
      right: 1010,
      width: 30,
      height: 30,
      x: 980,
      y: 100,
    };
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ ...rect, toJSON: () => rect });
    await userEvent.click(trigger());
    const dialog = screen.getByRole('dialog');
    // jsdom innerWidth 1024 → 폭 320, 오른쪽 여백 16 → left = 1024 - 16 - 320 = 688
    expect(dialog.style.top).toBe('138px');
    expect(dialog.style.left).toBe('688px');
  });

  it('Esc 는 팝오버를 닫고 트리거로 포커스를 돌려준다', async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Modal 안에서 Esc → 팝오버만 닫히고 모달은 유지(onClose 미호출, cancel 차단)', async () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />, withMotion);
    const modal = screen.getByRole('dialog', { name: '내 견적' });
    await userEvent.click(trigger());
    const input = await screen.findByRole('textbox', { name: '값' });
    await waitFor(() => expect(input).toHaveFocus());

    const keydown = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const modalKeydown = vi.fn();
    modal.addEventListener('keydown', modalKeydown);
    act(() => {
      input.dispatchEvent(keydown);
    });
    // 기본 동작(= dialog cancel) 과 바깥 전파가 막혔다
    expect(keydown.defaultPrevented).toBe(true);
    expect(modalKeydown).not.toHaveBeenCalled();
    // 같은 Esc 에서 브라우저가 cancel 을 내더라도 모달의 onCancel 에 닿지 않는다
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(modal, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(modal).not.toHaveAttribute('data-closing');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '품목명 필터' })).not.toBeInTheDocument(),
    );
    expect(trigger()).toHaveFocus();
    expect(modal).toHaveAttribute('open');
    expect(onClose).not.toHaveBeenCalled();

    // 팝오버가 닫힌 뒤의 Esc(cancel) 는 모달이 정상 처리한다
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent(modal, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('바깥 클릭으로 닫힌다 — 빈 곳이면 트리거로 포커스 복귀, 다른 컨트롤이면 그쪽 포커스 유지', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByText('빈 곳'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();

    await userEvent.click(trigger());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '바깥' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '바깥' })).toHaveFocus();
  });

  it('팝오버 안 클릭(터치 포함)은 닫지 않는다', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    await userEvent.pointer({
      keys: '[TouchA]',
      target: screen.getByRole('button', { name: '적용' }),
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('트리거 클릭은 호출자 토글만 — 이중 토글 없이 닫힌다', async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Tab 으로 팝오버를 벗어나면 닫힌다', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await userEvent.tab(); // 적용
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.tab(); // 바깥
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '바깥' })).toHaveFocus();
  });

  it('initialFocusRef 가 있으면 그 요소로 포커스', async () => {
    function WithInitial() {
      const ref = useRef<HTMLButtonElement>(null);
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={anchor} type="button">
            앵커
          </button>
          <Popover
            open
            onOpenChange={() => {}}
            anchorRef={anchor}
            label="x 필터"
            initialFocusRef={ref}
          >
            <input aria-label="값" />
            <button ref={ref} type="button">
              적용
            </button>
          </Popover>
        </>
      );
    }
    render(<WithInitial />, withMotion);
    await waitFor(() => expect(screen.getByRole('button', { name: '적용' })).toHaveFocus());
  });

  // A-1 QA 백로그: 비활성 버튼은 click 이 오지 않아 팝오버가 열린 채 포커스만 body 로 가던 문제
  it('비활성 버튼(바깥)을 누르면 닫히고 포커스는 트리거로', async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    const disabled = screen.getByRole('button', { name: '비활성' });
    // 브라우저처럼: pointerdown 은 오지만 click 은 오지 않고, 포커스는 body 로 빠진다
    fireEvent.pointerDown(disabled);
    (document.activeElement as HTMLElement).blur();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('포커스가 body 로 빠진 채 열려 있어도 Esc 로 닫히고 트리거로 포커스 복귀', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
  });

  it('모달 안: 포커스가 body 로 빠져도 Esc 는 팝오버만 닫고 모달은 유지', async () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox', { name: '값' })).toHaveFocus());
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '품목명 필터' })).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });
  it('모달 안: 백드롭 첫 클릭은 팝오버만 닫고 모달 유지, 다음 백드롭 클릭(누름·놓음 모두 백드롭)이 모달을 닫는다 (§7 Q2 A)', async () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />, withMotion);
    const modal = screen.getByRole('dialog', { name: '내 견적' });
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox', { name: '값' })).toHaveFocus());

    const backdropClick = () => {
      fireEvent.pointerDown(modal);
      fireEvent.pointerUp(modal);
      fireEvent.click(modal);
    };
    backdropClick();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '품목명 필터' })).not.toBeInTheDocument(),
    );
    expect(modal).toHaveAttribute('open');
    expect(modal).not.toHaveAttribute('data-closing');
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();

    backdropClick();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('Popover 선택형 id·describedBy·포인터 콜백 (erp-upload-guide §2-1 — InfoHint 용)', () => {
  it('기본(열 필터): id·aria-describedby 없음, 포인터 이탈로 닫히지 않는다', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    const dialog = screen.getByRole('dialog', { name: '품목명 필터' });
    expect(dialog).not.toHaveAttribute('aria-describedby');
    expect(dialog).not.toHaveAttribute('id');
    fireEvent.pointerLeave(dialog, { pointerType: 'mouse' });
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(screen.getByRole('dialog', { name: '품목명 필터' })).toBeInTheDocument();
  });

  it('id·describedBy 를 넘기면 본문이 설명으로 연결되고, 포인터 콜백이 불린다', async () => {
    const onPointerEnter = vi.fn();
    const onPointerLeave = vi.fn();
    function DescribedHarness() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} type="button">
            안내
          </button>
          <Popover
            open
            onOpenChange={() => {}}
            anchorRef={ref}
            label="안내 팝오버"
            id="hint-popover"
            describedBy="hint-body"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <p id="hint-body">본문 설명</p>
          </Popover>
        </>
      );
    }
    render(<DescribedHarness />, withMotion);
    const dialog = screen.getByRole('dialog', { name: '안내 팝오버' });
    expect(dialog).toHaveAttribute('id', 'hint-popover');
    expect(dialog).toHaveAccessibleDescription('본문 설명');
    fireEvent.pointerEnter(dialog, { pointerType: 'mouse' });
    fireEvent.pointerLeave(dialog, { pointerType: 'mouse' });
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onPointerLeave).toHaveBeenCalledTimes(1);
  });
});
