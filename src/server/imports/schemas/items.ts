import { z } from 'zod';

import {
  classifyItemKind,
  type ItemKind,
  type ItemKindRule,
} from '@/lib/constants/item-kind-rules';
import { mapItemStatus, type ItemStatus } from '@/lib/constants/item-status';
import { normalizeErpMajor } from '@/lib/constants/product-family';

import { isoDate, normalizeSpaces, optionalText, requiredText, type Cell } from '../cells';

import type { SheetColumn, SheetSpec } from './types';

/**
 * ERP 품목조회 파일 (PRAMI-003 §4.2.1 — 실파일 39컬럼 확정). 1행 제목 `품목조회`, 2행 헤더(상위 5행 탐색).
 * 처리: 정규(items 컬럼) · raw(items.raw jsonb, 빈 값 키 생략) · 제외(개인정보 — 값을 읽지도 저장하지도 않음, §4.2.2).
 * 헤더는 원문 그대로(공백 포함). 비교는 trim 만 한다.
 */
export const ITEM_HEADER_TREATMENTS = [
  ['품명', 'normal'],
  ['품번', 'normal'],
  ['규격', 'raw'],
  ['품목자산분류', 'raw'],
  ['기준단위', 'normal'],
  ['품목 상태', 'normal'],
  ['내외자구분', 'raw'],
  ['중요도', 'raw'],
  ['부서', 'raw'],
  ['관리자', 'excluded'],
  ['품목대분류', 'normal'],
  ['품목중분류', 'normal'],
  ['품목소분류', 'normal'],
  ['품목약명', 'raw'],
  ['영문명', 'raw'],
  ['영문약명', 'raw'],
  ['옵션품목', 'raw'],
  ['세트품목', 'raw'],
  ['모델상속', 'raw'],
  ['모델명', 'raw'],
  ['대표품명', 'raw'],
  ['BOM등록', 'raw'],
  ['제품별공정소요자재', 'raw'],
  ['LOT관리', 'raw'],
  ['Serial관리', 'raw'],
  ['등록일', 'normal'],
  ['등록자', 'excluded'],
  ['최종수정일', 'normal'],
  ['최종수정자', 'excluded'],
  ['비고', 'raw'],
  ['구매거래처', 'raw'],
  ['부가세구분', 'raw'],
  ['판매단가등록여부', 'raw'],
  ['판매단가에부가세포함', 'raw'],
  ['파일첨부여부', 'raw'],
  ['소요량 계산방식', 'raw'],
  ['불출구분', 'raw'],
  ['생산유형구분', 'raw'],
  ['생산사양', 'raw'],
] as const satisfies readonly (readonly [string, 'normal' | 'raw' | 'excluded'])[];

export type ItemHeader = (typeof ITEM_HEADER_TREATMENTS)[number][0];

const headersOf = (treatment: 'normal' | 'raw' | 'excluded') =>
  ITEM_HEADER_TREATMENTS.filter(([, kind]) => kind === treatment).map(([header]) => header);

/** 개인정보 제외 컬럼 (등록자·최종수정자·관리자) */
export const ITEM_EXCLUDED_HEADERS: readonly string[] = headersOf('excluded');
/** raw jsonb 로 보존하는 헤더 */
export const ITEM_RAW_HEADERS: readonly string[] = headersOf('raw');
/** ADMIN 화면에서만 보이는 자유 텍스트 (사람 이름이 섞일 수 있음, §4.2.2) */
export const ITEM_REMARK_HEADER = '비고';

/**
 * 품번 형식. 스펙 §4.2.1 의 `^P[0-9A-Z]+$` 에 한글 음절을 더했다 — 실데이터 ERP 품번 18개(예: `P20사용010001`)가
 * 한글을 포함하고 판매단가(9개)에서도 조인 키로 쓰인다. 이를 행 오류로 막으면 AC-304·AC-310·AC-311 고정값이 성립하지 않는다.
 */
const ITEM_CODE_PATTERN = /^P[0-9A-Z가-힣]+$/;

const itemCodeText = requiredText.refine(
  (value) => ITEM_CODE_PATTERN.test(value),
  '품번 형식(P + 영문 대문자·숫자·한글)이 아닙니다',
);
const statusText = requiredText.refine(
  (value) => mapItemStatus(value) !== null,
  '알 수 없는 품목 상태입니다 (임시·폐기·사용만 허용)',
);
const majorText = requiredText.refine(
  (value) => normalizeErpMajor(value) !== null,
  "알 수 없는 품목대분류입니다 (WAPPLES·D'Amo·iSIGN+·iSIGN+ PKI·Cloudbric)",
);
/** 빈 셀 → NULL, 값이 있으면 YYYY-MM-DD */
const optionalIsoDate = z
  .custom<Cell>()
  .pipe(
    z.union([
      z
        .custom<Cell>((value) => value === null || value === undefined || value === '')
        .transform(() => null),
      isoDate,
    ]),
  );

/** 정규 컬럼 (필수 6: 품명·품번·품목 상태·대·중·소분류) */
export const ITEM_COLUMNS = [
  { key: 'itemName', header: '품명', schema: requiredText, required: true },
  { key: 'itemCode', header: '품번', schema: itemCodeText, required: true },
  { key: 'baseUnit', header: '기준단위', schema: optionalText, required: false },
  {
    key: 'itemStatusRaw',
    header: '품목 상태',
    schema: statusText,
    required: true,
    errorCode: 'unmapped_status',
  },
  {
    key: 'categoryMajorRaw',
    header: '품목대분류',
    schema: majorText,
    required: true,
    errorCode: 'unknown_major',
  },
  { key: 'categoryMid', header: '품목중분류', schema: requiredText, required: true },
  { key: 'categoryMinor', header: '품목소분류', schema: requiredText, required: true },
  { key: 'erpRegisteredOn', header: '등록일', schema: optionalIsoDate, required: false },
  { key: 'erpModifiedOn', header: '최종수정일', schema: optionalIsoDate, required: false },
] as const satisfies readonly SheetColumn[];

export const ITEM_REQUIRED_HEADERS: readonly string[] = ITEM_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.header);

export type ItemRow = {
  itemCode: string;
  /** NBSP → 공백 정규화 */
  itemName: string;
  categoryMajorRaw: string;
  /** 정규화 제품군 (§4.2.4) */
  categoryMajor: string;
  categoryMid: string;
  categoryMinor: string;
  itemStatusRaw: string;
  itemStatus: ItemStatus;
  baseUnit: string | null;
  erpRegisteredOn: string | null;
  erpModifiedOn: string | null;
  itemKind: ItemKind;
  itemKindRule: ItemKindRule;
  raw: Record<string, unknown>;
};

type ParsedValues = {
  itemName: string;
  itemCode: string;
  baseUnit: string | null;
  itemStatusRaw: string;
  categoryMajorRaw: string;
  categoryMid: string;
  categoryMinor: string;
  erpRegisteredOn: string | null;
  erpModifiedOn: string | null;
};

/** 변환된 정규 값 + raw 헤더 값 → 스테이징 행 (상태·대분류 정규화, 종류 판정 K0~K7) */
export function buildItemRow(values: ParsedValues, raw: Record<string, unknown>): ItemRow {
  const itemName = normalizeSpaces(values.itemName);
  const { kind, rule } = classifyItemKind({
    itemCode: values.itemCode,
    major: values.categoryMajorRaw,
    mid: values.categoryMid,
    minor: values.categoryMinor,
  });
  return {
    ...values,
    itemName,
    categoryMajor: normalizeErpMajor(values.categoryMajorRaw)!,
    itemStatus: mapItemStatus(values.itemStatusRaw)!,
    itemKind: kind,
    itemKindRule: rule,
    // 품명은 정규 컬럼이지만 NBSP 정규화로 원문과 달라질 때만 원문을 raw 에 남긴다 (§4.2.1 #1, AC-302)
    raw: itemName === values.itemName ? raw : { ...raw, 품명: values.itemName },
  };
}

export const ITEM_SPEC: SheetSpec<ItemRow> = {
  label: '품목조회',
  preferredSheets: [],
  columns: ITEM_COLUMNS,
  rawColumns: ITEM_RAW_HEADERS,
  excludedColumns: ITEM_EXCLUDED_HEADERS,
  strictHeaders: true,
  build: (values, raw) => buildItemRow(values as ParsedValues, raw),
  uniqueKey: {
    describe: '같은 품번이 이미 있습니다',
    of: (row) => row.itemCode,
    errorCode: 'duplicate_item_code',
  },
};
