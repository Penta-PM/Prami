import {
  codeText,
  currencyCode,
  flag,
  isoDate,
  itemNameText,
  money,
  nonNegativeInt,
  optionalText,
  positiveInt,
  requiredText,
  yesNo,
} from '../cells';
import { salesSeriesKey } from '../series';

import type { SheetColumn, SheetSpec } from './types';

/**
 * 판매단가 20컬럼 (§4.3.1). 엑셀 헤더 원문·순서 그대로. 헤더는 공백 trim 후 정확 일치로 감지한다.
 * 키는 sales_prices 원본 블록의 Drizzle 속성명과 같다.
 */
export const SALES_COLUMNS = [
  { key: 'sourceId', header: 'id', schema: positiveInt, required: true },
  { key: 'productFamily', header: '제품군', schema: requiredText, required: true },
  { key: 'itemCode', header: '품번', schema: requiredText, required: true },
  { key: 'itemName', header: '품명', schema: itemNameText, required: true },
  { key: 'spec', header: '규격', schema: optionalText, required: true },
  { key: 'unit', header: '단위', schema: requiredText, required: true },
  { key: 'priceType', header: '단가유형', schema: optionalText, required: true },
  { key: 'priceCategory', header: '단가구분', schema: requiredText, required: true },
  { key: 'currency', header: '화폐', schema: currencyCode, required: true },
  { key: 'hasCorePrice', header: '코어단가유무', schema: yesNo, required: true },
  { key: 'unitPrice', header: '단가', schema: money, required: true },
  { key: 'remark', header: '비고', schema: optionalText, required: true },
  { key: 'effectiveFrom', header: '적용시작일', schema: isoDate, required: true },
  { key: 'appliesToAllCustomers', header: '전체고객적용여부', schema: flag, required: true },
  { key: 'isFinalSource', header: '최종여부', schema: flag, required: true },
  { key: 'baseCoreCount', header: '기준코어수', schema: nonNegativeInt, required: true },
  { key: 'unitPricePerCore', header: '단가(1코어)', schema: money, required: true },
  { key: 'customerCode', header: '거래처코드', schema: codeText, required: true },
  { key: 'customerNo', header: '고객 번호', schema: optionalText, required: true },
  { key: 'customerName', header: '고객명', schema: optionalText, required: true },
] as const satisfies readonly SheetColumn[];

export type SalesRow = {
  sourceId: number;
  productFamily: string;
  itemCode: string;
  itemName: string;
  spec: string | null;
  unit: string;
  priceType: string | null;
  priceCategory: string;
  currency: string;
  hasCorePrice: boolean;
  unitPrice: string;
  remark: string | null;
  effectiveFrom: string;
  appliesToAllCustomers: boolean;
  isFinalSource: boolean;
  baseCoreCount: number;
  unitPricePerCore: string;
  customerCode: string;
  customerNo: string | null;
  customerName: string | null;
};

export const SALES_SPEC: SheetSpec<SalesRow> = {
  label: '판매단가',
  preferredSheets: ['RAW'],
  columns: SALES_COLUMNS,
  build: (values) => values as SalesRow,
  // 원본에서 중복 0건 확인 — 위반 시 행 오류 (§4.3.1 제약)
  uniqueKey: {
    describe: '계열(품번·단가유형·단가구분·화폐·거래처코드)과 적용시작일이 같은 행이 이미 있습니다',
    of: (row) => `${salesSeriesKey(row)}#${row.effectiveFrom}`,
  },
};
