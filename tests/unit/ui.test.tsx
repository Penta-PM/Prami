import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  Card,
  CardTitle,
  Drawer,
  Input,
  Modal,
  Pill,
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';

describe('Button', () => {
  it('기본 type 은 button 이고 variant/size 클래스를 적용한다', () => {
    render(
      <Button variant="primary" size="sm">
        저장
      </Button>,
    );
    const button = screen.getByRole('button', { name: '저장' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('bg-action-bg');
    expect(button.className).toContain('h-8');
  });

  it('secondary 가 기본이며 className 을 병합한다', () => {
    render(<Button className="px-8">확인</Button>);
    const button = screen.getByRole('button', { name: '확인' });
    expect(button.className).toContain('bg-gray-75');
    expect(button.className).toContain('px-8');
    expect(button.className).not.toContain('px-4');
  });

  it.each(['ghost', 'danger'] as const)('%s variant 를 렌더한다', (variant) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('Pill', () => {
  it.each(['neutral', 'positive', 'purple', 'amber', 'red'] as const)(
    '%s tone 을 렌더한다',
    (tone) => {
      render(<Pill tone={tone}>사용</Pill>);
      expect(screen.getByText('사용')).toBeInTheDocument();
    },
  );
  it('글자색은 배경 위 4.5:1 이상 토큰 — amber-700·red-600 (원본 amber-500 1.9:1·red-500 3.7:1 아님, BL-1)', () => {
    render(
      <>
        <Pill tone="amber">가견적</Pill>
        <Pill tone="red">비활성</Pill>
      </>,
    );
    expect(screen.getByText('가견적')).toHaveClass('text-amber-700');
    expect(screen.getByText('가견적')).not.toHaveClass('text-amber-500');
    expect(screen.getByText('비활성')).toHaveClass('text-red-600');
  });
});

describe('Segmented', () => {
  it('선택된 항목을 aria-checked 로 표시하고 클릭 시 onChange 를 호출한다', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        aria-label="날짜 모드"
        value="start"
        onChange={onChange}
        options={[
          { value: 'start', label: '적용시작일' },
          { value: 'period', label: '적용기간' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: '적용시작일' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('radio', { name: '적용기간' }));
    expect(onChange).toHaveBeenCalledWith('period');
  });

  it('방향키로 선택을 이동하고 끝에서 순환한다', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        aria-label="탭"
        value="b"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ]}
      />,
    );
    const current = screen.getByRole('radio', { name: 'B' });
    expect(current).toHaveAttribute('tabindex', '0');
    current.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('c');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('a');
    await userEvent.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('a');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe('Card / Input / Table', () => {
  it('Card 와 CardTitle 을 렌더한다', () => {
    render(
      <Card>
        <CardTitle>공지사항</CardTitle>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: '공지사항' })).toBeInTheDocument();
  });

  it('Input 은 leading 아이콘이 있으면 왼콽 여백을 넓힌다', () => {
    render(<Input aria-label="검색" leading={<span data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '검색' }).className).toContain('pl-10');
  });

  it('Input 은 leading 이 없으면 기본 여백을 쓴다', () => {
    render(<Input aria-label="이름" />);
    expect(screen.getByRole('textbox', { name: '이름' }).className).toContain('pl-3.5');
  });

  it('Table 프리미티브는 표 시맨틱을 유지한다', () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>품목명</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>WAPPLES SA</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: '품목명' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'WAPPLES SA' })).toBeInTheDocument();
  });
});

/** 실제 사용처처럼 onClose 가 open 상태를 갱신하는 제어 컴포넌트 */
function ControlledModal({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Modal
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="제어 모달"
      >
        내용
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('open 이면 제목과 내용을 보이고 닫기 버튼이 onClose 를 호출한다', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="가격정책 등록" footer={<Button>저장</Button>}>
        내용
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: '가격정책 등록' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('제어 컴포넌트에서 닫기 1회에 onClose 는 정확히 1번 호출되고 다시 열 수 있다', async () => {
    const onClose = vi.fn();
    render(<ControlledModal onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).not.toHaveAttribute('open');

    await userEvent.click(screen.getByRole('button', { name: '열기' }));
    expect(dialog).toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('open 이 false 이면 dialog 가 닫혀 있다', () => {
    render(
      <Modal open={false} onClose={() => undefined} title="닫힘">
        내용
      </Modal>,
    );
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
  });
});

describe('Drawer', () => {
  it('open 이 false 이면 렌더하지 않는다', () => {
    render(
      <Drawer open={false} onClose={() => undefined} title="상세">
        내용
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('오버레이 클릭과 Esc 로 onClose 를 호출한다', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="행 상세" width={400}>
        내용
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: '행 상세' });
    expect(dialog).toHaveStyle({ width: '400px' });
    await userEvent.click(screen.getByTestId('drawer-overlay'));
    dialog.focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('열리면 패널 안으로 포커스를 옮기고 Tab 을 패널 안에서 순환시킨다', async () => {
    render(
      <>
        <button type="button">바깥</button>
        <Drawer open onClose={() => undefined} title="포커스">
          <button type="button">안쪽</button>
        </Drawer>
      </>,
    );
    const close = screen.getByRole('button', { name: '닫기' });
    const inner = screen.getByRole('button', { name: '안쪽' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(inner).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(inner).toHaveFocus();
  });

  it('닫히면 이전 포커스를 복원한다', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            트리거
          </button>
          <Drawer open={open} onClose={() => setOpen(false)} title="복원">
            내용
          </Drawer>
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: '트리거' });
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
