import { optionalText, requiredText } from '../cells';

import type { SheetColumn, SheetSpec } from './types';

/**
 * 파츠 매핑 엑셀 (§4.3.6). 1차 정식 포맷은 품번 기준(모델품번, 파츠품번). 품명 컬럼은 참고용으로 보존.
 * 존재하지 않는 품번 검사는 업로드 시 DB 조회로 한다 (upload.ts).
 */
export const PART_COLUMNS = [
  { key: 'modelItemCode', header: '모델품번', schema: requiredText, required: true },
  { key: 'partItemCode', header: '파츠품번', schema: requiredText, required: true },
  { key: 'modelName', header: '모델명', schema: optionalText, required: false },
  { key: 'partName', header: '파츠명', schema: optionalText, required: false },
] as const satisfies readonly SheetColumn[];

export type PartRow = {
  modelItemCode: string;
  partItemCode: string;
  modelName: string | null;
  partName: string | null;
};

export const PART_SPEC: SheetSpec<PartRow> = {
  label: '파츠 매핑',
  preferredSheets: [],
  columns: PART_COLUMNS,
  build: (values) => values as PartRow,
  uniqueKey: {
    describe: '같은 모델·파츠 조합이 이미 있습니다',
    of: (row) => `${row.modelItemCode}|${row.partItemCode}`,
  },
};
