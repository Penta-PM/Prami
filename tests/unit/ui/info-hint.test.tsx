import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { ErpPathHint, INFO_HINT_LEAVE_DELAY_MS, InfoHint } from '@/components/ui';

/**
 * 안내 토글팁 InfoHint (erp-upload-guide §2-1·§6.1): 클릭·Enter·Space 열기, hover 열기 없음, Esc·바깥·Tab 이탈 닫기,
 * 마우스 이탈 200ms 뒤 닫기(재진입 취소·키보드로 연 경우·터치 제외), aria 속성·describedby.
 */
const withMotion = { wrapper: MotionProvider };

const NAME = '판매단가 파일 ERP 메뉴 경로';
const trigger = () => screen.getByRole('button', { name: NAME });
const sleep = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

function Harness() {
  return (
    <div>
      <button type="button">앞</button>
      <ErpPathHint
        label="판매단가 파일"
        item="가격정책 관리 품목 업데이트"
        path="기본정보 > 품목단가 > 판매단가등록"
      />
      <button type="button">뒤</button>
      <p>빈 곳</p>
    </div>
  );
}

describe('InfoHint / ErpPathHint', () => {
  it('트리거 aria: 이름 "{라벨} ERP 메뉴 경로", haspopup=dialog, expanded 토글, 열렸을 때만 controls', async () => {
    render(<Harness />, withMotion);
    const button = trigger();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    // 자체 SVG 아이콘(장식) — 유니코드 ⓘ 글자 없음
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button.textContent).not.toContain('ⓘ');
    expect(button).toHaveClass('size-6');

    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: NAME });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', dialog.id);
    expect(dialog).not.toHaveAttribute('aria-modal');
    // 본문(항목명 굵게 + 경로)이 dialog 설명으로 연결된다
    expect(dialog).toHaveAccessibleDescription(
      '가격정책 관리 품목 업데이트 기본정보 > 품목단가 > 판매단가등록',
    );
    expect(screen.getByText('가격정책 관리 품목 업데이트').tagName).toBe('STRONG');
    // 입력이 없으니 팝오버 자신으로 포커스 → 열리면 이름·설명이 낭독된다
    await waitFor(() => expect(dialog).toHaveFocus());

    await userEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('hover 로는 열리지 않는다', async () => {
    render(<Harness />, withMotion);
    await userEvent.hover(trigger());
    await sleep(INFO_HINT_LEAVE_DELAY_MS + 50);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Enter·Space 로 열고 Esc 로 닫으면 트리거로 포커스 복귀', async () => {
    render(<Harness />, withMotion);
    await userEvent.tab();
    await userEvent.tab();
    expect(trigger()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('dialog', { name: NAME })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();

    await userEvent.keyboard(' ');
    await waitFor(() => expect(screen.getByRole('dialog', { name: NAME })).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
  });

  it('바깥 클릭(탭)으로 닫힌다', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByText('빈 곳'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
  });

  it('Tab 으로 팝오버를 벗어나면 닫힌다', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('마우스로 연 뒤 버튼·팝오버 영역을 벗어나면 약 200ms 뒤 닫히고 포커스는 트리거로', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    await userEvent.unhover(trigger());
    // 지연 안에서는 아직 열려 있다
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });

  it('지연 안에 버튼 → 팝오버로 다시 들어오면 닫기 취소, 팝오버에서 나가면 닫힘', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    const dialog = screen.getByRole('dialog');
    await userEvent.unhover(trigger());
    await userEvent.hover(dialog);
    await sleep(INFO_HINT_LEAVE_DELAY_MS + 100);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.unhover(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('키보드로 연 경우에는 포인터 이탈로 닫지 않는다', async () => {
    render(<Harness />, withMotion);
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await userEvent.hover(trigger());
    await userEvent.unhover(trigger());
    fireEvent.pointerLeave(dialog, { pointerType: 'mouse' });
    await sleep(INFO_HINT_LEAVE_DELAY_MS + 100);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('터치 포인터 이탈로는 닫지 않는다 (바깥 탭으로 닫힘)', async () => {
    render(<Harness />, withMotion);
    await userEvent.click(trigger());
    fireEvent.pointerLeave(trigger(), { pointerType: 'touch' });
    fireEvent.pointerLeave(screen.getByRole('dialog'), { pointerType: 'touch' });
    await sleep(INFO_HINT_LEAVE_DELAY_MS + 100);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('보이는 글자(text)가 있으면 그 글자가 이름 — aria-label 없음, 아이콘 + 글자', async () => {
    render(
      <InfoHint name="PRAMI ERP 데이터" text="PRAMI ERP 데이터">
        본문
      </InfoHint>,
      withMotion,
    );
    const button = screen.getByRole('button', { name: 'PRAMI ERP 데이터' });
    expect(button).not.toHaveAttribute('aria-label');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'PRAMI ERP 데이터' })).toHaveAccessibleDescription(
      '본문',
    );
  });
});
