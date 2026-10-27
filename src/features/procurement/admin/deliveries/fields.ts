// 클라이언트(편집 폼·표 필터)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';

/**
 * 조달 관리 · 실적 관리(조달이 통합 UI-6) 편집 필드 정의 — 순수 모듈(서버 모듈·procurement 스키마 import 없음).
 * 필드 키에 DB 열 이름(납품요구 표의 담당조달청 등)이 들어가므로 조달 경로(features/procurement) 안에 둔다(격리 소스 스캔).
 * 편집 폼(클라이언트)·서버 액션 입력 검증·변경 이력(delivery_changes) 표시가 같은 필드 목록·값 규칙을 쓴다.
 *
 * - 필드 순서·라벨은 조달이 원본 납품요구 편집 화면(전 필드)과 같다.
 * - delivery_changes 의 before/after 키는 **DB 열 이름(snake_case)** — 원본 이력과 같은 모양이라 이관(단계 4)한 이력도 그대로 읽힌다.
 * - 금액(계약단가·납품금액·납품요구총금액)은 원 단위 정수, 수량은 숫자(numeric).
 */

export type DeliveryFieldType = 'date' | 'text' | 'int' | 'num';

export const DELIVERY_EDIT_FIELDS = [
  { key: 'dlvrReqDate', column: 'dlvr_req_date', label: '납품요구일자', type: 'date' },
  { key: 'dlvrReqNo', column: 'dlvr_req_no', label: '납품요구번호', type: 'text', required: true },
  {
    key: 'changeOrd',
    column: 'change_ord',
    label: '납품요구변경차수',
    type: 'text',
    required: true,
  },
  { key: 'demandOrg', column: 'demand_org', label: '수요기관', type: 'text' },
  { key: 'demandOrgType', column: 'demand_org_type', label: '수요기관유형', type: 'text' },
  { key: 'businessName', column: 'business_name', label: '사업명', type: 'text' },
  { key: 'contractNo', column: 'contract_no', label: '계약번호', type: 'text' },
  { key: 'contractType', column: 'contract_type', label: '계약종류', type: 'text' },
  { key: 'vendor', column: 'vendor', label: '납품업체명', type: 'text' },
  { key: 'vendorType', column: 'vendor_type', label: '납품업체구분', type: 'text' },
  { key: 'vendorAddress', column: 'vendor_address', label: '납품업체소재지', type: 'text' },
  { key: 'procurementOffice', column: 'procurement_office', label: '담당조달청', type: 'text' },
  { key: 'classCode', column: 'class_code', label: '물품분류코드', type: 'text' },
  { key: 'className', column: 'class_name', label: '물품분류명', type: 'text' },
  { key: 'itemId', column: 'item_id', label: '물품식별번호', type: 'text', required: true },
  { key: 'itemName', column: 'item_name', label: '물품식별명', type: 'text' },
  { key: 'dueDate', column: 'due_date', label: '납품기한일자', type: 'date' },
  { key: 'unitPrice', column: 'unit_price', label: '계약단가', type: 'int' },
  { key: 'unit', column: 'unit', label: '단위', type: 'text' },
  { key: 'quantity', column: 'quantity', label: '납품수량', type: 'num' },
  { key: 'amount', column: 'amount', label: '납품금액', type: 'int' },
  { key: 'totalAmount', column: 'total_amount', label: '납품요구총금액', type: 'int' },
  { key: 'collectedOn', column: 'collected_on', label: '조회일자', type: 'date' },
] as const satisfies readonly {
  key: string;
  column: string;
  label: string;
  type: DeliveryFieldType;
  required?: boolean;
}[];

export type DeliveryField = (typeof DELIVERY_EDIT_FIELDS)[number];
export type DeliveryFieldKey = DeliveryField['key'];

export const DELIVERY_FIELD_KEYS = DELIVERY_EDIT_FIELDS.map((field) => field.key) as [
  DeliveryFieldKey,
  ...DeliveryFieldKey[],
];

/** 편집 가능한 값 (date = 'YYYY-MM-DD', int = 원 단위 정수, num = 숫자 문자열(numeric) 또는 숫자) */
export type DeliveryFieldValue = string | number | null;
export type DeliveryValues = Record<DeliveryFieldKey, DeliveryFieldValue>;

/** 이력(delivery_changes) JSON 의 휴지통 표시 키 — 원본과 같다(`after.excluded === true` = 삭제 기록) */
export const EXCLUDED_COLUMN = 'excluded';

const LABEL_BY_COLUMN: Record<string, string> = Object.fromEntries(
  DELIVERY_EDIT_FIELDS.map((field) => [field.column, field.label]),
);

/** 이력 키(열 이름) → 라벨. 모르는 키는 그대로 */
export function deliveryColumnLabel(column: string): string {
  if (column === EXCLUDED_COLUMN) return '휴지통';
  return LABEL_BY_COLUMN[column] ?? column;
}

/** 텍스트 칸 최대 길이 */
export const DELIVERY_TEXT_MAX = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function numberText(raw: string): string {
  return raw.replace(/,/g, '').trim();
}

/**
 * 비교용 정규형 문자열 — 빈 값(null·''·공백) = ''. 숫자는 쉼표를 떼고 Number 로(수량 '3.50' = '3.5'), 텍스트는 trim.
 * 저장 시 바뀐 칸 판단·동시 편집 재검증(현재 값 = 화면이 읽은 값?)이 이 규칙 하나로 비교한다.
 */
export function canonicalDeliveryValue(type: DeliveryFieldType, value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (text === '') return '';
  if (type === 'int' || type === 'num') {
    const n = Number(numberText(text));
    return Number.isFinite(n) ? String(n) : text;
  }
  return text;
}

export type ParsedFieldValue =
  { ok: true; value: string | number | null } | { ok: false; message: string };

/**
 * 폼 입력(문자열) → 저장 값. date = 'YYYY-MM-DD'|null, int = 안전 정수|null, num = 유한 숫자|null, text = trim|null.
 * 필수 칸(납품요구번호·변경차수·물품식별번호)은 비울 수 없다.
 */
export function parseDeliveryFieldValue(field: DeliveryField, raw: unknown): ParsedFieldValue {
  const text =
    raw === null || raw === undefined ? '' : typeof raw === 'number' ? String(raw) : String(raw);
  const trimmed = text.trim();
  if (trimmed === '') {
    if ('required' in field && field.required)
      return { ok: false, message: `${field.label}은(는) 비울 수 없습니다.` };
    return { ok: true, value: null };
  }
  switch (field.type) {
    case 'date':
      return isValidDate(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, message: `${field.label}은(는) YYYY-MM-DD 형식으로 입력해 주세요.` };
    case 'int': {
      const n = Number(numberText(trimmed));
      if (!Number.isFinite(n))
        return { ok: false, message: `${field.label}은(는) 숫자로 입력해 주세요.` };
      if (!Number.isSafeInteger(n))
        return { ok: false, message: `${field.label}은(는) 원 단위 정수로 입력해 주세요.` };
      return { ok: true, value: n };
    }
    case 'num': {
      const n = Number(numberText(trimmed));
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, message: `${field.label}은(는) 숫자로 입력해 주세요.` };
    }
    case 'text':
      return trimmed.length > DELIVERY_TEXT_MAX
        ? {
            ok: false,
            message: `${field.label}은(는) ${DELIVERY_TEXT_MAX}자 이하로 입력해 주세요.`,
          }
        : { ok: true, value: trimmed };
  }
}

/** 폼 표시 문자열 (값 없음 = '') */
export function deliveryFormText(value: DeliveryFieldValue | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

const deliveryId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const deliveryIdInputSchema = z.object({ id: deliveryId });
export type DeliveryIdInput = z.input<typeof deliveryIdInputSchema>;

const fieldValue = z.union([z.string().max(DELIVERY_TEXT_MAX * 2), z.number(), z.null()]);
const valuesShape = Object.fromEntries(
  DELIVERY_FIELD_KEYS.map((key) => [key, fieldValue]),
) as Record<DeliveryFieldKey, typeof fieldValue>;

/**
 * 편집 저장 입력: values = 폼 값(전 필드), expected = 편집을 연 시점의 값(동시 편집 재검증 기준 — 서버의 현재 값과 다르면 "이미 처리됨").
 */
export const deliveryUpdateInputSchema = z.object({
  id: deliveryId,
  values: z.object(valuesShape).strict(),
  expected: z.object(valuesShape).strict(),
});
export type DeliveryUpdateInput = z.input<typeof deliveryUpdateInputSchema>;

/** 동시 편집·이미 처리된 항목 안내 (CONFLICT details.reason = 'stale') */
export const DELIVERY_STALE_MESSAGE =
  '이미 처리됨 — 다른 사람이 먼저 바꿨습니다. 최신 내용으로 새로 고칩니다.';
export const DELIVERY_DUPLICATE_MESSAGE = '같은 납품요구번호·물품식별번호·변경차수가 이미 있어요.';

export type DeliveryConflictReason = 'stale' | 'duplicate';

/** 감사 행위 (D-8) */
export const AUDIT_DELIVERY_UPDATE = 'procurement.delivery.update';
export const AUDIT_DELIVERY_EXCLUDE = 'procurement.delivery.exclude';
export const AUDIT_DELIVERY_RESTORE = 'procurement.delivery.restore';

/** 변경 이력 표시 개수 (원본과 같다) */
export const DELIVERY_HISTORY_LIMIT = 10;
