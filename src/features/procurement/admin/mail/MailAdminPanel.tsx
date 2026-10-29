'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';

import {
  Button,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { formatDateTime } from '@/lib/date-format';
import {
  checkMailRecipient,
  MAIL_RECIPIENT_MAX,
  mailReportText,
  NO_MAIL_RECIPIENTS_TEXT,
  NO_MAIL_REPORT_TEXT,
} from '@/lib/procurement/mail-recipients';
import type { ActionResult } from '@/lib/result';
import type { MailReportBoard, MailRecipientView } from '@/server/procurement/mail-recipients';

import { formatCollectedAt } from '../../ProcurementHeader';
import { addMailRecipientAction } from './actions';
import { MailRecipientRemoveModal } from './MailRecipientRemoveModal';

/**
 * 메일 보고 탭 (수집기 Prami 이전 §3.1): 상태 카드(마지막 일일 보고 실행 시각·결과, 마지막 보고 기준일) + 수신처 목록·추가.
 * 목록은 RSC(MailAdminSection)가 서버에서 읽어 `board` 로 넘긴다. 추가·삭제 뒤에는 router.refresh() 로 다시 읽는다.
 * 입력 검사(형식·대소문자 무시 중복·20개)는 서버와 같은 규칙으로 먼저 보고, 서버 VALIDATION 도 입력칸 아래에 보여 준다.
 * 동시 편집: 서버가 CONFLICT("이미 처리됨")를 돌려주면 안내(role=status) 후 새로 불러온다.
 */
export function MailAdminPanel({ board }: { board: MailReportBoard }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<MailRecipientView | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();
  const errorId = useId();
  const { recipients, lastReport, lastEndDate } = board;
  const full = recipients.length >= MAIL_RECIPIENT_MAX;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending || !draft.trim()) return;
    const checked = checkMailRecipient(
      draft,
      recipients.map((row) => row.email),
    );
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    startTransition(async () => {
      const result = await addMailRecipientAction({ email: checked.email });
      if (result.ok) {
        setDraft('');
        setError(null);
        setNotice(`추가했습니다: ${result.data.email}`);
        router.refresh();
        return;
      }
      if (result.error.code === 'VALIDATION') {
        setError(result.error.fieldErrors?.email?.[0] ?? result.error.message);
        return;
      }
      if (result.error.code === 'CONFLICT') {
        setDraft('');
        setNotice(`${result.error.message} — 목록을 새로 불러왔습니다`);
        router.refresh();
        return;
      }
      setNotice(null);
      setError(result.error.message);
    });
  };

  const removed = (result: ActionResult<MailRecipientView>) => {
    setPendingRemove(null);
    setNotice(
      result.ok
        ? `삭제했습니다: ${result.data.email}`
        : `${result.error.message} — 목록을 새로 불러왔습니다`,
    );
    router.refresh();
  };

  const ranAt = lastReport ? new Date(lastReport.ranAt) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-6">
        <h2 className="m-0 text-text-primary [font:var(--text-h2)]">일일 보고 메일</h2>
        <dl
          aria-label="보고 메일 상태"
          className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[14px]"
        >
          <dt className="font-semibold text-text-tertiary">마지막 보고 실행</dt>
          <dd
            className="m-0 text-text-primary tabular-nums"
            data-testid="procurement-mail-last-run"
          >
            {ranAt ? (
              <time dateTime={ranAt.toISOString()}>{formatCollectedAt(ranAt)}</time>
            ) : (
              NO_MAIL_REPORT_TEXT
            )}
          </dd>
          <dt className="font-semibold text-text-tertiary">결과</dt>
          <dd className="m-0 text-text-primary" data-testid="procurement-mail-result">
            {lastReport ? mailReportText(lastReport) : NO_MAIL_REPORT_TEXT}
            {lastReport?.runStatus === 'failed' ? (
              <span className="text-text-tertiary"> (수집 실행 실패)</span>
            ) : null}
          </dd>
          <dt className="font-semibold text-text-tertiary">마지막 보고 기준일</dt>
          <dd
            className="m-0 text-text-primary tabular-nums"
            data-testid="procurement-mail-last-end-date"
          >
            {lastEndDate ?? NO_MAIL_REPORT_TEXT}
          </dd>
        </dl>
        <p className="m-0 text-[12px] leading-relaxed break-keep text-text-tertiary">
          평일 아침 수집이 끝나면 아래 수신처에 보고 메일을 한 통 보냅니다(받는 사람끼리 주소는
          보이지 않습니다). 바꾼 수신처는 다음 보고부터 반영됩니다.
        </p>
      </Card>

      <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="m-0 text-text-primary [font:var(--text-h2)]">수신처</h2>
          <span className="text-[12px] text-text-tertiary tabular-nums">
            {recipients.length} / {MAIL_RECIPIENT_MAX}개
          </span>
        </div>
        <p role="status" className="m-0 min-h-[1em] text-[12px] text-text-secondary">
          {notice}
        </p>
        <form noValidate onSubmit={submit} className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-[12px] font-semibold text-text-tertiary">
            수신처 추가
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              id={inputId}
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              placeholder="name@example.com"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              wrapperClassName="min-w-0 max-w-80 flex-1"
              className="py-1.5"
            />
            <Button type="submit" size="sm" disabled={isPending || !draft.trim()}>
              추가
            </Button>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="m-0 text-[12px] text-text-danger">
              {error}
            </p>
          ) : full ? (
            <p className="m-0 text-[12px] text-text-tertiary">
              최대 {MAIL_RECIPIENT_MAX}개까지 등록할 수 있습니다.
            </p>
          ) : null}
        </form>
        {recipients.length === 0 ? (
          <p
            className="m-0 rounded-xl bg-surface-muted px-5 py-6 text-center text-[14px] text-text-tertiary"
            data-testid="procurement-mail-empty"
          >
            {NO_MAIL_RECIPIENTS_TEXT}
          </p>
        ) : (
          <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
            <Table aria-label="메일 수신처">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>주소</TableHeaderCell>
                  <TableHeaderCell>추가한 사람</TableHeaderCell>
                  <TableHeaderCell>추가 시각</TableHeaderCell>
                  <TableHeaderCell className="text-center">삭제</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recipients.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-[160px] break-all">{row.email}</TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary">
                      {row.addedBy ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary tabular-nums">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Button
                        size="sm"
                        aria-label={`${row.email} 삭제`}
                        onClick={() => setPendingRemove(row)}
                      >
                        삭제
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {pendingRemove ? (
        <MailRecipientRemoveModal
          recipient={pendingRemove}
          remaining={recipients.length - 1}
          onClose={() => setPendingRemove(null)}
          onDone={removed}
        />
      ) : null}
    </div>
  );
}
