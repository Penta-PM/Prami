import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { Presence } from '@/components/motion/Presence';
import { Drawer, Modal } from '@/components/ui';

/**
 * Motion 도입 스펙 §3.3 모달·드로어 퇴장 — 네 경로(닫기 버튼·Esc·백드롭·프로그램적 닫힘) 모두 퇴장 애니메이션을 거친 뒤
 * 사라지고, 사용자 행동 1회에 onClose 는 정확히 1회다. tests/setup.ts 가 skipAnimations=true 를 깔아 두므로
 * 퇴장 완료 콜백은 다음 프레임에 돌아온다 — 사라짐은 waitFor 로 기다린다.
 * jsdom 은 Esc → cancel 이벤트를 만들지 않으므로 cancel 을 직접 dispatch 한다 (setup.ts 폴리필에도 없음).
 * m.* 는 LazyMotion(MotionProvider) 안에서만 애니메이션 feature 를 갖는다 — 완료 콜백 경로를 검증하려고 wrapper 로 감싼다.
 */
const withMotion = { wrapper: MotionProvider };

describe('Modal 퇴장 (Motion 도입 스펙 §3.3)', () => {
  it('① Esc(cancel) 는 네이티브 즉시 닫힘을 막고 퇴장 뒤 onClose 를 정확히 1회 호출한다', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Esc">
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    // 퇴장 시작 직후에는 아직 열려 있고 패널은 클릭을 받지 않는다
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('data-closing');
    expect(screen.getByRole('heading', { name: 'Esc' }).parentElement?.parentElement).toHaveClass(
      'pointer-events-none',
    );

    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).not.toHaveAttribute('data-closing');
  });

  it('퇴장 중 Esc 연타는 무시된다 — onClose 1회', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="연타">
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog);
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('② 닫기 버튼은 퇴장 뒤 onClose 1회', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="버튼">
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('② 백드롭 클릭(dialog 자신이 target)은 퇴장 뒤 onClose 1회, 패널 안 클릭은 닫지 않는다', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="백드롭">
        <span>내용</span>
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByText('내용'));
    expect(dialog).not.toHaveAttribute('data-closing');

    fireEvent.click(dialog);
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('③ 부모가 open=false 로 닫으면 퇴장 뒤 dialog 가 닫히고 onClose 는 호출되지 않는다', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="부모">
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('open');

    rerender(
      <Modal open={false} onClose={onClose} title="부모">
        내용
      </Modal>,
    );
    expect(dialog).toHaveAttribute('data-closing');
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(onClose).not.toHaveBeenCalled();

    // 다시 열 수 있다
    rerender(
      <Modal open onClose={onClose} title="부모">
        내용
      </Modal>,
    );
    expect(dialog).toHaveAttribute('open');
  });

  it('③-b 부모가 닫는 퇴장 도중 다시 open=true 가 되면 퇴장을 취소하고 열린 채 유지한다 — onClose 미호출 (스펙 §9.1 Q2)', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="재열기">
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');

    rerender(
      <Modal open={false} onClose={onClose} title="재열기">
        내용
      </Modal>,
    );
    expect(dialog).toHaveAttribute('data-closing');
    // 퇴장 완료(다음 프레임) 전에 다시 연다
    rerender(
      <Modal open onClose={onClose} title="재열기">
        내용
      </Modal>,
    );
    expect(dialog).not.toHaveAttribute('data-closing');

    // 퇴장 완료 시점이 지나도 닫히지 않는다
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(dialog).toHaveAttribute('open');
    expect(dialog).not.toHaveAttribute('data-closing');
    expect(
      screen.getByRole('heading', { name: '재열기' }).parentElement?.parentElement,
    ).not.toHaveClass('pointer-events-none');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('④ <Presence> 아래에서 언마운트되면 에러 없이 제거되고 onClose 는 호출되지 않는다', async () => {
    const onClose = vi.fn();
    function Host({ show }: { show: boolean }) {
      return (
        <Presence>
          {show ? (
            <Modal open onClose={onClose} title="프레즌스">
              내용
            </Modal>
          ) : null}
        </Presence>
      );
    }
    const { rerender } = render(<Host show />, withMotion);
    expect(screen.getByRole('dialog')).toHaveAttribute('open');

    rerender(<Host show={false} />);
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('④ <Presence> 아래에서 닫기 버튼으로 닫으면 onClose 1회 뒤 부모 언마운트로 제거된다', async () => {
    const onClose = vi.fn();
    function Host() {
      const [show, setShow] = useState(true);
      return (
        <Presence>
          {show ? (
            <Modal
              open
              onClose={() => {
                onClose();
                setShow(false);
              }}
              title="프레즌스 닫기"
            >
              내용
            </Modal>
          ) : null}
        </Presence>
      );
    }
    render(<Host />, withMotion);
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('⑤ 퇴장이 시작되는 시점에 포커스가 열었던 트리거로 돌아간다', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            트리거
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="포커스">
            <button type="button">안쪽</button>
          </Modal>
        </>
      );
    }
    render(<Host />, withMotion);
    const trigger = screen.getByRole('button', { name: '트리거' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('open');
    screen.getByRole('button', { name: '안쪽' }).focus();

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    // 아직 열려 있지만(퇴장 중) 포커스는 이미 트리거에 있다
    expect(dialog).toHaveAttribute('open');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(trigger).toHaveFocus();
  });
});

describe('Modal — LazyMotion 바깥(feature 미로드) 안전장치', () => {
  it('애니메이션이 시작되지 않으면 완료 콜백을 기다리지 않고 바로 닫는다 — onClose 1회', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="단독 렌더">
        내용
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(dialog).not.toHaveAttribute('open');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('<Presence> 아래 단독 렌더에서도 언마운트되면 제거된다', async () => {
    const { rerender } = render(
      <Presence>
        <Modal open onClose={() => undefined} title="단독 프레즌스">
          내용
        </Modal>
      </Presence>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    rerender(<Presence>{null}</Presence>);
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
  });
});

describe('Drawer 퇴장 (Motion 도입 스펙 §3.3)', () => {
  it('⑥ open=false 가 되면 퇴장이 시작되는 시점에 포커스를 복원하고 패널은 inert 가 된 뒤 제거된다', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            트리거
          </button>
          <Drawer open={open} onClose={() => setOpen(false)} title="드로어">
            내용
          </Drawer>
        </>
      );
    }
    render(<Host />, withMotion);
    const trigger = screen.getByRole('button', { name: '트리거' });
    await userEvent.click(trigger);
    const panel = screen.getByRole('dialog', { name: '드로어' });
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    // Presence 가 아직 패널을 붙들고 있는 동안(퇴장) 포커스는 트리거에 있고 패널은 inert · 클릭 무반응
    expect(panel).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(panel).toHaveAttribute('inert');
    expect(panel.parentElement).toHaveClass('pointer-events-none');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('⑥-b 포커스를 받지 않는 트리거(표 행 클릭)로 열었으면 퇴장 시작 시 inert 패널 안의 포커스를 놓는다', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <table>
            <tbody>
              <tr data-testid="row" onClick={() => setOpen(true)}>
                <td>행</td>
              </tr>
            </tbody>
          </table>
          <Drawer open={open} onClose={() => setOpen(false)} title="행 상세">
            내용
          </Drawer>
        </>
      );
    }
    render(<Host />, withMotion);
    fireEvent.click(screen.getByTestId('row'));
    const panel = screen.getByRole('dialog', { name: '행 상세' });
    const close = screen.getByRole('button', { name: '닫기' });
    expect(close).toHaveFocus();

    fireEvent.click(close);
    expect(panel).toHaveAttribute('inert');
    expect(panel).not.toContainElement(document.activeElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

/**
 * 실제 애니메이션 경로 (QA #35 CRITICAL): setup.ts 의 skipAnimations 를 끄고, 부모 open=false 닫힘이 안전장치(즉시 닫기)가
 * 아니라 퇴장 애니메이션 완료(onAnimationComplete('exit'))로 닫히는지 본다. 퇴장 160ms 동안은 dialog 가 열려 있어야 한다.
 */
describe('Modal 퇴장 — 실제 애니메이션 (skipAnimations 끔)', () => {
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
  });
  afterEach(() => {
    MotionGlobalConfig.skipAnimations = true;
  });

  async function openThenParentClose(title: string) {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title={title}>
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 320)); // 진입 240ms 완료
    rerender(
      <Modal open={false} onClose={onClose} title={title}>
        내용
      </Modal>,
    );
    return { dialog, onClose, rerender };
  }

  it('부모 open=false 는 퇴장(160ms) 동안 열려 있다가 퇴장이 끝난 뒤 닫힌다 — onClose 미호출', async () => {
    const { dialog, onClose } = await openThenParentClose('부모 실제');
    expect(dialog).toHaveAttribute('data-closing');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(dialog).toHaveAttribute('open');
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'), { timeout: 1000 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('부모가 닫는 퇴장 도중 다시 열면 취소되어 열린 채 남는다 (§9.1 Q2, 실제 애니메이션)', async () => {
    const { dialog, onClose, rerender } = await openThenParentClose('재열기 실제');
    await new Promise((resolve) => setTimeout(resolve, 60));
    rerender(
      <Modal open onClose={onClose} title="재열기 실제">
        내용
      </Modal>,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(dialog).toHaveAttribute('open');
    expect(dialog).not.toHaveAttribute('data-closing');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc 는 퇴장 동안 열려 있다가 닫히고 onClose 1회', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Esc 실제">
        내용
      </Modal>,
      withMotion,
    );
    const dialog = screen.getByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 320));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(dialog).toHaveAttribute('open');
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'), { timeout: 1000 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
