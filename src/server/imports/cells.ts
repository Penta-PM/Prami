import { z } from 'zod';

/**
 * 엑셀 셀 값 → DB 값 변환 (§4.3.1 "변환 규칙" 열). 값·의미는 바꾸지 않고 타입만 최소 변환한다.
 * read-excel-file 은 셀을 string | number | boolean | Date | null 로 돌려준다.
 */
export type Cell = string | number | boolean | Date | null | undefined;

const NBSP = /\u00a0/g;

function isBlank(value: Cell): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

/** 앞뒤 공백 제거. 숫자 셀은 문자열화한다 (정수는 소수점 없이) */
function toText(value: Cell): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

const requiredMessage = '값이 비어 있습니다';

/** 필수 텍스트 (trim) */
export const requiredText = z.custom<Cell>().transform((value, ctx) => {
  if (isBlank(value)) {
    ctx.addIssue({ code: 'custom', message: requiredMessage });
    return z.NEVER;
  }
  return toText(value);
});

/** 선택 텍스트: 빈 셀 → NULL, 숫자 셀은 문자열화(`1` → "1") */
export const optionalText = z
  .custom<Cell>()
  .transform((value) => (isBlank(value) ? null : toText(value)));

/**
 * 코드 값(거래처코드 등): 문자열화하고 선행 0 을 보존한다. 숫자 셀이면 정수 표기 그대로.
 * 필수.
 */
export const codeText = requiredText;

/** 화폐: 대문자 3자 */
export const currencyCode = requiredText.pipe(
  z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, '화폐는 영문 3자여야 합니다')),
);

const TRUE_WORDS = new Set(['Y', 'TRUE', '1']);
const FALSE_WORDS = new Set(['N', 'FALSE', '0']);

/** 불리언: Excel bool, TRUE/FALSE, Y/N. 그 외 값은 행 오류 */
export const flag = z.custom<Cell>().transform((value, ctx) => {
  if (typeof value === 'boolean') return value;
  const word = isBlank(value) ? '' : toText(value).toUpperCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  ctx.addIssue({ code: 'custom', message: 'Y/N 또는 TRUE/FALSE 여야 합니다' });
  return z.NEVER;
});

/** Y/N 만 허용 (코어단가유무) */
export const yesNo = z.custom<Cell>().transform((value, ctx) => {
  const word = isBlank(value) ? '' : toText(value).toUpperCase();
  if (word === 'Y') return true;
  if (word === 'N') return false;
  ctx.addIssue({ code: 'custom', message: 'Y 또는 N 이어야 합니다' });
  return z.NEVER;
});

function parseNumber(value: Cell): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/,/g, '').trim();
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/** numeric(18,2) 금액: 숫자, 음수는 행 오류. DB 에는 문자열로 넘긴다(정밀도 보존) */
export const money = z.custom<Cell>().transform((value, ctx) => {
  const parsed = parseNumber(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    ctx.addIssue({ code: 'custom', message: '숫자가 아닙니다' });
    return z.NEVER;
  }
  if (parsed < 0) {
    ctx.addIssue({ code: 'custom', message: '음수는 허용되지 않습니다' });
    return z.NEVER;
  }
  if (Math.abs(parsed) >= 1e16) {
    ctx.addIssue({ code: 'custom', message: '값이 너무 큽니다' });
    return z.NEVER;
  }
  return parsed.toFixed(2);
});

/** 0 이상 정수 */
export const nonNegativeInt = z.custom<Cell>().transform((value, ctx) => {
  const parsed = parseNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) {
    ctx.addIssue({ code: 'custom', message: '0 이상의 정수가 아닙니다' });
    return z.NEVER;
  }
  return parsed;
});

/** Excel 날짜 직렬값(1900 체계) → YYYY-MM-DD */
export function excelSerialToIsoDate(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function isValidIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** 날짜: `YYYY-MM-DD` 문자열, Date 셀, Excel 직렬값 허용. 파싱 실패는 행 오류 */
export const isoDate = z.custom<Cell>().transform((value, ctx) => {
  let text: string | null = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    text = value.toISOString().slice(0, 10);
  } else if (typeof value === 'number' && value > 0 && value < 2_958_466) {
    text = excelSerialToIsoDate(value);
  } else if (typeof value === 'string') {
    text = value.trim().replace(/[./]/g, '-');
  }
  if (!text || !isValidIsoDate(text)) {
    ctx.addIssue({ code: 'custom', message: '날짜 형식(YYYY-MM-DD)이 아닙니다' });
    return z.NEVER;
  }
  return text;
});

/** 원 식별자 id: 1 이상 정수 */
export const positiveInt = nonNegativeInt.refine((value) => value > 0, '1 이상의 정수가 아닙니다');

/** 품명: trim 만 한다 (NBSP 정규화는 검색 인덱스 표현식에서만 — §4.3.1) */
export const itemNameText = requiredText;

/** 검색·비교용 정규화 (NBSP → 공백) */
export function normalizeSpaces(value: string): string {
  return value.replace(NBSP, ' ');
}
