import { currencyCode, flag, isoDate, money, optionalText, requiredText } from '../cells';

import type { SheetColumn, SheetSpec } from './types';

/** 원가 — 구매단가등록 12컬럼 (§4.3.4). 1행 제목 + 2행 헤더 원본도 헤더 감지로 처리 */
export const COST_COLUMNS = [
  { key: 'materialCode', header: '자재번호', schema: requiredText, required: true },
  { key: 'materialName', header: '자재명', schema: requiredText, required: true },
  { key: 'spec', header: '규격', schema: optionalText, required: true },
  { key: 'unit', header: '단위', schema: requiredText, required: true },
  { key: 'priceType', header: '단가유형', schema: requiredText, required: true },
  { key: 'priceCategory', header: '단가구분', schema: requiredText, required: true },
  { key: 'currency', header: '화폐', schema: currencyCode, required: true },
  { key: 'unitCost', header: '단가', schema: money, required: true },
  { key: 'effectiveFrom', header: '적용시작일', schema: isoDate, required: true },
  { key: 'isFinalSource', header: '최종여부', schema: flag, required: true },
  { key: 'remark', header: '비고', schema: optionalText, required: true },
  { key: 'appliesToAllCustomers', header: '전체고객적용여부', schema: flag, required: true },
] as const satisfies readonly SheetColumn[];

export type CostRow = {
  materialCode: string;
  materialName: string;
  spec: string | null;
  unit: string;
  priceType: string;
  priceCategory: string;
  currency: string;
  unitCost: string;
  effectiveFrom: string;
  isFinalSource: boolean;
  remark: string | null;
  appliesToAllCustomers: boolean;
};

export const COST_SPEC: SheetSpec<CostRow> = {
  label: '원가',
  preferredSheets: ['Sheet1'],
  columns: COST_COLUMNS,
  build: (values) => values as CostRow,
  uniqueKey: {
    describe: '계열(자재번호·단가유형·단가구분·화폐)과 적용시작일이 같은 행이 이미 있습니다',
    of: (row) =>
      [row.materialCode, row.priceType, row.priceCategory, row.currency, row.effectiveFrom].join(
        '|',
      ),
  },
};
