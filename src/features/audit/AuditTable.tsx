import {
  Pill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import {
  AUDIT_RESULT_LABELS,
  formatAuditTarget,
  formatAuditTime,
  summarizeJson,
  type AuditDisplayRow,
} from '@/lib/audit-format';

const RESULT_TONES = { success: 'positive', denied: 'red', error: 'amber' } as const;

const HEADERS = ['일시', '사용자', '행위', '대상', '변경 전', '변경 후', 'IP'] as const;

/** 감사 로그 표 (디자인 열 순서: 일시·사용자·행위·대상·변경 전·변경 후·IP·결과) */
export function AuditTable({ rows }: { rows: readonly AuditDisplayRow[] }) {
  return (
    <div className="overflow-hidden rounded-[10px] bg-surface-card shadow-(--hairline-default)">
      <Table aria-label="감사 로그">
        <TableHead className="bg-gray-75">
          <tr>
            {HEADERS.map((header) => (
              <TableHeaderCell key={header} className="py-3.5 first:pl-4">
                {header}
              </TableHeaderCell>
            ))}
            <TableHeaderCell className="py-3.5 pr-4 text-center">결과</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={HEADERS.length + 1}
                className="px-4 py-10 text-center text-[13px] text-text-tertiary"
              >
                조건에 맞는 감사 로그가 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row) => <AuditRow key={row.id} row={row} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function AuditRow({ row }: { row: AuditDisplayRow }) {
  return (
    <TableRow className="text-[12px]">
      <TableCell className="pl-4 whitespace-nowrap text-text-tertiary">
        {formatAuditTime(row.createdAt)}
      </TableCell>
      <TableCell className="font-medium whitespace-nowrap">{row.actorLabel}</TableCell>
      <TableCell className="font-semibold whitespace-nowrap">{row.action}</TableCell>
      <TableCell className="text-text-secondary">{formatAuditTarget(row)}</TableCell>
      <TableCell className="max-w-[220px] text-text-tertiary">
        {summarizeJson(row.before) || '—'}
      </TableCell>
      <TableCell className="max-w-[220px] text-text-tertiary">
        {summarizeJson(row.after) || '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-tertiary">{row.ip ?? '—'}</TableCell>
      <TableCell className="pr-4 text-center">
        <Pill tone={RESULT_TONES[row.result]}>{AUDIT_RESULT_LABELS[row.result]}</Pill>
      </TableCell>
    </TableRow>
  );
}
