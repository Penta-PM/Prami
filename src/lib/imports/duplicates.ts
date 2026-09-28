/**
 * 원가 같은 날짜 중복 경고 (§4.4.7 r4, Main 결정 B). 서버(스테이징·material_costs 집계)와 클라이언트(목록 표시)가 함께 쓰는 순수 모양.
 * 같은 계열 키 + 같은 적용시작일 행은 오류가 아니라 경고이며, 단가가 서로 다른 그룹은 별도 목록으로 다시 보여 준다.
 */
export type DuplicateGroup = {
  seriesKey: string;
  effectiveFrom: string;
  /** 원본 파일의 데이터 행 번호(헤더 다음 행 = 1), 오름차순 */
  sourceRows: number[];
  /** sourceRows 와 같은 순서의 단가 */
  unitCosts: string[];
};

export type DuplicateWarnings = {
  sameDateDuplicates: DuplicateGroup[];
  conflictingDuplicates: DuplicateGroup[];
};

export const EMPTY_DUPLICATE_WARNINGS: DuplicateWarnings = {
  sameDateDuplicates: [],
  conflictingDuplicates: [],
};

export function isConflictingGroup(group: DuplicateGroup): boolean {
  return new Set(group.unitCosts).size > 1;
}

/** 전체 그룹 → `{ 전부, 값이 다른 그룹만 }` */
export function splitDuplicateGroups(groups: readonly DuplicateGroup[]): DuplicateWarnings {
  return {
    sameDateDuplicates: [...groups],
    conflictingDuplicates: groups.filter(isConflictingGroup),
  };
}
