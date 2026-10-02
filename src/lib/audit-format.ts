/** 감사 로그 표시·CSV 공통 포맷 (서버·클라이언트 모두 사용) */

import { formatDateTimeSeconds } from '@/lib/date-format';

export type AuditDisplayRow = {
  id: number;
  createdAt: Date;
  actorLabel: string;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  result: 'success' | 'denied' | 'error';
  reason: string | null;
};

export const AUDIT_RESULT_LABELS: Record<AuditDisplayRow['result'], string> = {
  success: '성공',
  denied: '거부',
  error: '오류',
};

/** 한국 시간 `YYYY-MM-DD HH:mm:ss` — 공용 포맷(src/lib/date-format.ts)에 위임, 출력 불변 */
export function formatAuditTime(value: Date): string {
  return formatDateTimeSeconds(value);
}

/** jsonb 값을 `key: value, …` 한 줄로 요약한다 */
export function summarizeJson(value: Record<string, unknown> | null): string {
  if (!value) return '';
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${item === null ? '—' : String(item)}`)
    .join(', ');
}

export function formatAuditTarget(
  row: Pick<AuditDisplayRow, 'targetType' | 'targetLabel' | 'targetId'>,
) {
  const label = row.targetLabel ?? row.targetId;
  if (!row.targetType) return label ?? '';
  return label ? `${row.targetType} · ${label}` : row.targetType;
}

const CSV_HEADERS = ['일시', '사용자', '행위', '대상', '변경 전', '변경 후', 'IP', '결과', '사유'];

/**
 * CSV 셀 이스케이프. 스프레드시트 수식 주입을 막기 위해 =,+,-,@,탭,CR 로 시작하는 값 앞에 ' 를 붙인다.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 을 붙인다 */
export function toAuditCsv(rows: readonly AuditDisplayRow[]): string {
  const lines = rows.map((row) =>
    [
      formatAuditTime(row.createdAt),
      row.actorLabel,
      row.action,
      formatAuditTarget(row),
      summarizeJson(row.before),
      summarizeJson(row.after),
      row.ip ?? '',
      AUDIT_RESULT_LABELS[row.result],
      row.reason ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[CSV_HEADERS.join(','), ...lines].join('\r\n')}\r\n`;
}
