import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailRecipientView, MailReportBoard } from '@/server/procurement/mail-recipients';

/**
 * 수집기 Prami 이전 §3.1 메일 보고 화면 — 상태 카드 문구, 빈 상태, 추가(입력 아래 검증 안내), 삭제 확인 모달.
 * Server Action 은 모킹(합성 주소만). confirm/alert 를 쓰지 않는다.
 */
const actions = vi.hoisted(() => ({
  addMailRecipientAction: vi.fn(),
  removeMailRecipientAction: vi.fn(),
}));
vi.mock('@/features/procurement/admin/mail/actions', () => actions);
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { MailAdminPanel } = await import('@/features/procurement/admin/mail/MailAdminPanel');

function rcpt(id: number, email: string, addedBy: string | null = 'tester'): MailRecipientView {
  return { id, email, addedBy, createdAt: '2026-10-27T00:30:00.000Z' };
}

const BOARD: MailReportBoard = {
  recipients: [rcpt(1, 'Ops@example.invalid'), rcpt(2, 'sales@example.invalid', null)],
  lastReport: {
    outcome: 'sent',
    recipientCount: 2,
    ranAt: '2026-10-28T00:20:00.000Z',
    runStatus: 'ok',
  },
  lastEndDate: '2026-10-27',
};

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (code: string, message: string, fieldErrors?: Record<string, string[]>) => ({
  ok: false as const,
  error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) },
});

const confirmSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = confirmSpy;
});

const input = () => screen.getByRole('textbox', { name: '수신처 추가' });
const addForm = () => input().closest('form')!;

describe('상태 카드', () => {
  it('마지막 보고 실행(KST)·결과·보고 기준일', () => {
    render(<MailAdminPanel board={BOARD} />);
    expect(screen.getByTestId('procurement-mail-last-run')).toHaveTextContent(
      '2026-10-28 09:20 (KST)',
    );
    expect(screen.getByTestId('procurement-mail-result')).toHaveTextContent('발송함 2명');
    expect(screen.getByTestId('procurement-mail-last-end-date')).toHaveTextContent('2026-10-27');
  });

  it.each([
    ['skipped_no_recipients', '수신처 없음 — 보내지 않음'],
    ['skipped_no_smtp', '메일 설정 없음 — 보내지 않음'],
    ['failed', '발송 실패'],
    [null, '기록 없음'],
  ] as const)('%s → "%s"', (outcome, text) => {
    render(
      <MailAdminPanel
        board={{ ...BOARD, lastReport: { ...BOARD.lastReport!, outcome, recipientCount: null } }}
      />,
    );
    expect(screen.getByTestId('procurement-mail-result')).toHaveTextContent(text);
  });

  it('실행 기록이 없으면 "기록 없음", 실패한 실행은 (수집 실행 실패) 를 덧붙인다', () => {
    const { rerender } = render(
      <MailAdminPanel board={{ ...BOARD, lastReport: null, lastEndDate: null }} />,
    );
    expect(screen.getByTestId('procurement-mail-last-run')).toHaveTextContent('기록 없음');
    expect(screen.getByTestId('procurement-mail-result')).toHaveTextContent('기록 없음');
    expect(screen.getByTestId('procurement-mail-last-end-date')).toHaveTextContent('기록 없음');
    rerender(
      <MailAdminPanel
        board={{
          ...BOARD,
          lastReport: { ...BOARD.lastReport!, outcome: null, runStatus: 'failed' },
        }}
      />,
    );
    expect(screen.getByTestId('procurement-mail-result')).toHaveTextContent(
      '기록 없음 (수집 실행 실패)',
    );
  });
});

describe('수신처 목록', () => {
  it('주소·추가한 사람·추가 시각(KST), 개수', () => {
    render(<MailAdminPanel board={BOARD} />);
    const table = screen.getByRole('table', { name: '메일 수신처' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['Ops@example.invalid', 'tester', '2026-10-27 09:30', '삭제'],
      ['sales@example.invalid', '—', '2026-10-27 09:30', '삭제'],
    ]);
    expect(screen.getByText('2 / 20개')).toBeInTheDocument();
  });

  it('빈 상태 문구', () => {
    render(<MailAdminPanel board={{ ...BOARD, recipients: [] }} />);
    expect(screen.getByText('수신처가 없어 보고 메일을 보내지 않습니다')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('추가', () => {
  it('Enter → 앞뒤 공백 제거한 값으로 Action 호출, 입력 비움, 안내 + 새로 불러오기', async () => {
    render(<MailAdminPanel board={BOARD} />);
    actions.addMailRecipientAction.mockResolvedValue(ok(rcpt(3, 'new@example.invalid')));
    await userEvent.type(input(), '  new@example.invalid {Enter}');
    expect(actions.addMailRecipientAction).toHaveBeenCalledWith({ email: 'new@example.invalid' });
    await waitFor(() => expect(input()).toHaveValue(''));
    expect(screen.getByRole('status')).toHaveTextContent('추가했습니다: new@example.invalid');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('형식 오류·대소문자 무시 중복은 화면에서 막고(Action 미호출) 입력칸 아래 안내', async () => {
    render(<MailAdminPanel board={BOARD} />);
    await userEvent.type(input(), 'not-an-address{Enter}');
    const alert = within(addForm()).getByRole('alert');
    expect(alert).toHaveTextContent('메일 주소 형식이 아닙니다');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveAttribute('aria-describedby', alert.id);

    await userEvent.clear(input());
    await userEvent.type(input(), 'OPS@EXAMPLE.INVALID{Enter}');
    expect(within(addForm()).getByRole('alert')).toHaveTextContent(
      '이미 등록된 주소입니다: Ops@example.invalid',
    );
    expect(actions.addMailRecipientAction).not.toHaveBeenCalled();
  });

  it('20개면 더 추가하지 않고 안내', async () => {
    const recipients = Array.from({ length: 20 }, (_, i) => rcpt(i + 1, `r${i}@example.com`));
    render(<MailAdminPanel board={{ ...BOARD, recipients }} />);
    expect(screen.getByText('최대 20개까지 등록할 수 있습니다.')).toBeInTheDocument();
    await userEvent.type(input(), 'more@example.com{Enter}');
    expect(within(addForm()).getByRole('alert')).toHaveTextContent(
      '수신처는 최대 20개까지 등록할 수 있습니다',
    );
    expect(actions.addMailRecipientAction).not.toHaveBeenCalled();
  });

  it('서버 VALIDATION 은 입력칸 아래(값 유지), 그 밖의 CONFLICT 는 "이미 처리됨" + 새로 불러오기', async () => {
    render(<MailAdminPanel board={BOARD} />);
    actions.addMailRecipientAction.mockResolvedValueOnce(
      fail('VALIDATION', '이미 등록된 주소입니다: x@example.invalid', {
        email: ['이미 등록된 주소입니다: x@example.invalid'],
      }),
    );
    await userEvent.type(input(), 'X@example.invalid{Enter}');
    expect(await within(addForm()).findByRole('alert')).toHaveTextContent(
      '이미 등록된 주소입니다: x@example.invalid',
    );
    expect(input()).toHaveValue('X@example.invalid');
    expect(refresh).not.toHaveBeenCalled();

    actions.addMailRecipientAction.mockResolvedValueOnce(fail('CONFLICT', '이미 처리됨 — 가상'));
    await userEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '이미 처리됨 — 가상 — 목록을 새로 불러왔습니다',
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('삭제 (확인 모달)', () => {
  it('삭제 버튼 → 확인 모달 → 취소하면 삭제하지 않는다', async () => {
    render(<MailAdminPanel board={BOARD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ops@example.invalid 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '수신처 삭제' });
    expect(dialog).toHaveTextContent('Ops@example.invalid 수신처를 삭제할까요?');
    expect(dialog).not.toHaveTextContent('보고 메일이 멈춥니다');
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.removeMailRecipientAction).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('모달에서 삭제 → Action(id) → 안내 + 새로 불러오기. 마지막 수신처면 메일이 멈춘다고 알린다', async () => {
    render(<MailAdminPanel board={{ ...BOARD, recipients: [rcpt(7, 'last@example.invalid')] }} />);
    actions.removeMailRecipientAction.mockResolvedValue(ok(rcpt(7, 'last@example.invalid')));
    await userEvent.click(screen.getByRole('button', { name: 'last@example.invalid 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '수신처 삭제' });
    expect(dialog).toHaveTextContent('남는 수신처가 없어 보고 메일이 멈춥니다');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(actions.removeMailRecipientAction).toHaveBeenCalledWith({ id: 7 });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('삭제했습니다: last@example.invalid'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('이미 삭제됨(CONFLICT) → 안내 + 모달 닫고 새로 불러오기, 그 밖의 오류는 모달 안에', async () => {
    render(<MailAdminPanel board={BOARD} />);
    actions.removeMailRecipientAction.mockResolvedValueOnce(
      fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'sales@example.invalid 삭제' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('권한이 없습니다');

    actions.removeMailRecipientAction.mockResolvedValueOnce(
      fail('CONFLICT', '이미 처리됨 — 이미 삭제된 수신처입니다'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '이미 처리됨 — 이미 삭제된 수신처입니다 — 목록을 새로 불러왔습니다',
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
