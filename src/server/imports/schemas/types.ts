import type { z } from 'zod';

import type { Cell } from '../cells';

/** 엑셀 컬럼 1개: 원문 헤더명 ↔ 행 객체 키 ↔ 셀 변환 스키마 */
export type SheetColumn<K extends string = string> = {
  key: K;
  header: string;
  schema: z.ZodType<unknown, Cell>;
  /** 헤더 감지에 필요한 컬럼인지 (없으면 배치 failed) */
  required: boolean;
};

/** 파일 종류별 파싱 규칙 (§4.4.1) */
export type SheetSpec<Row> = {
  label: string;
  /** 우선 선택할 시트명 (없으면 첫 시트) */
  preferredSheets: readonly string[];
  columns: readonly SheetColumn[];
  /** 변환된 컬럼 값 → 행 객체 (추가 필드 계산 포함) */
  build: (values: Record<string, unknown>, extras: Record<string, unknown>) => Row;
  /**
   * 파일 내 중복 키. 같은 키가 두 번 나오면 policy='error'(기본)는 뒤 행이 행 오류,
   * policy='warn' 은 두 행 모두 적재하되 경고로 집계한다(값이 다르면 별도 표시). 원가는 warn (Main 결정, PR-5)
   */
  uniqueKey?: {
    describe: string;
    of: (row: Row) => string;
    policy?: 'error' | 'warn';
    /** warn 정책에서 값 비교에 쓸 대표 값 (예: 단가) */
    compareValue?: (row: Row) => string;
  };
};
