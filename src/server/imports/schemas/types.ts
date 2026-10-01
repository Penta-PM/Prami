import type { z } from 'zod';

import type { Cell } from '../cells';

/** 엑셀 컬럼 1개: 원문 헤더명 ↔ 행 객체 키 ↔ 셀 변환 스키마 */
export type SheetColumn<K extends string = string> = {
  key: K;
  header: string;
  schema: z.ZodType<unknown, Cell>;
  /** 헤더 감지에 필요한 컬럼인지 (없으면 배치 failed) */
  required: boolean;
  /** 변환 실패 시 행 오류에 붙일 검증 코드 (예: unknown_major, PRAMI-003 §4.2.3) */
  errorCode?: string;
};

/** 파일 종류별 파싱 규칙 (§4.4.1) */
export type SheetSpec<Row> = {
  label: string;
  /** 우선 선택할 시트명 (없으면 첫 시트) */
  preferredSheets: readonly string[];
  columns: readonly SheetColumn[];
  /**
   * (strictHeaders 전용) raw jsonb 로 원문 보존할 헤더 — 빈 값은 키를 생략한다 (PRAMI-003 §4.2.1)
   */
  rawColumns?: readonly string[];
  /** (strictHeaders 전용) 인식하되 저장하지 않는 헤더 — 개인정보 등 (PRAMI-003 §4.2.2). 값은 읽지 않는다 */
  excludedColumns?: readonly string[];
  /**
   * true 면 정의에 없는 헤더는 경고 `extra_header` 만 내고 값을 저장하지 않는다(새 컬럼으로 개인정보가 들어올 수 있음),
   * 정의된 비필수 헤더가 없으면 경고 `missing_header`. false(기본)는 기존 동작: 정의에 없는 컬럼 값을 extras(raw)로 넘긴다.
   */
  strictHeaders?: boolean;
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
    /** error 정책의 행 오류 검증 코드 (예: duplicate_item_code) */
    errorCode?: string;
    /** error 정책의 행 오류에 표시할 컬럼명 (예: 품번). 없으면 빈 값 — 복합 키는 한 컬럼으로 가리킬 수 없다 */
    column?: string;
  };
};
