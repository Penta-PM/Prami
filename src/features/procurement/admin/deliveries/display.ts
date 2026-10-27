import { formatDateTime } from '@/lib/date-format';
import {
  canonicalDeliveryValue,
  DELIVERY_EDIT_FIELDS,
  deliveryColumnLabel,
  EXCLUDED_COLUMN,
  type DeliveryFieldKey,
  type DeliveryValues,
} from '@/features/procurement/admin/deliveries/fields';
import { EMPTY_VALUE } from '@/lib/procurement/format';
import type { ActionError } from '@/lib/result';

/** 실적 관리 화면 표시 규칙 (조달이 통합 UI-6). 순수 모듈 */

/** "이미 처리됨" — 다른 사람이 먼저 바꿨거나(CONFLICT stale) 행이 없어졌다(NOT_FOUND). 화면은 안내 후 새로 고친다 */
export function isStaleError(error: ActionError): boolean {
  return (
    error.code === 'NOT_FOUND' || (error.code === 'CONFLICT' && error.details?.reason === 'stale')
  );
}

/** 이력 값 표시 — 숫자는 자릿수 구분, 빈 값 '—' */
export function historyValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  if (typeof value === 'number') return value.toLocaleString('ko-KR');
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}

/** 이력 한 건의 바뀐 칸 문구 목록 (`라벨: 이전 → 이후`, 휴지통 이동·되살림은 동작 이름) */
export function historyChangeTexts(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  return Object.keys(after ?? {}).map((column) => {
    const next = after?.[column];
    if (column === EXCLUDED_COLUMN) return next === true ? '휴지통으로 옮김' : '되살림';
    return `${deliveryColumnLabel(column)}: ${historyValueText(before?.[column])} → ${historyValueText(next)}`;
  });
}

/** 이력 시각 (KST) */
export function historyTime(iso: string): string {
  return formatDateTime(iso);
}

export type DeliveryFormChange = { key: DeliveryFieldKey; label: string; from: string; to: string };

/** 폼 값과 원래 값의 차이 (저장 확인 모달 목록 — 서버와 같은 정규형 비교) */
export function formChanges(
  original: DeliveryValues,
  form: Record<DeliveryFieldKey, string>,
): DeliveryFormChange[] {
  const changes: DeliveryFormChange[] = [];
  for (const field of DELIVERY_EDIT_FIELDS) {
    const from = canonicalDeliveryValue(field.type, original[field.key]);
    const to = canonicalDeliveryValue(field.type, form[field.key]);
    if (from === to) continue;
    changes.push({
      key: field.key,
      label: field.label,
      from: from === '' ? EMPTY_VALUE : from,
      to: to === '' ? EMPTY_VALUE : to,
    });
  }
  return changes;
}

/** 수량 칸 (numeric 문자열 → 자릿수 구분) */
export function quantityText(value: string | null): string {
  if (value === null || value === '') return EMPTY_VALUE;
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : value;
}

/** 납품요구 이름 (번호-차수) */
export function deliveryName(row: { dlvrReqNo: string; changeOrd: string }): string {
  return `${row.dlvrReqNo}-${row.changeOrd}`;
}
