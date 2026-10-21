import type { DataTableSort } from './types';

/**
 * 헤더 빠른 연속 클릭 (page-state-memory §6 — Plan 결정, BL-2).
 * 정렬은 URL(sort prop)이 기준이라 router.replace/push 가 반영되기 전에 다시 누르면 낡은 URL 상태에서 다음 단계를 계산해
 * 두 번 눌러도 오름차순에 머문다. 그래서 아직 URL 에 반영되지 않은 요청을 기억해 다음 클릭은 '직전 클릭의 결과'에서 계산한다.
 *
 * - requested: 요청한 정렬 키 순서, landed: URL 이 따라잡은 마지막 요청 위치(-1 = 아직 없음)
 * - URL 이 마지막 요청까지 따라잡으면 비운다. 중간 요청을 지나가는 중이면 유지한다.
 * - URL 이 요청 목록에 없는 값으로 바뀌면(필터 초기화·뒤로 가기 등 외부 변경) 비운다 — 외부 상태가 이긴다.
 * React·라우터에 의존하지 않는 순수 함수 — DataTable 이 ref 로 들고 다닌다.
 */
export type PendingSort = {
  requested: readonly string[];
  landed: number;
  next: DataTableSort;
};

export function sortKey(sort: DataTableSort): string {
  return sort ? `${sort.id}:${sort.dir}` : '';
}

/** 다음 단계 계산의 기준 — 대기 중인 요청이 있으면 그 결과, 없으면 URL 상태 */
export function sortBase(pending: PendingSort | null, current: DataTableSort): DataTableSort {
  return pending ? pending.next : current;
}

/**
 * 클릭으로 next 를 요청했을 때의 대기 상태. 요청이 지금 URL 과 같아도(오름 → 내림 → 해제로 한 바퀴) 비우지 않는다 —
 * 중간 요청(오름·내림)이 뒤늦게 URL 에 반영될 수 있어서다. 라우터가 중간 이동을 건너뛰면 대기 상태가 남지만 next 가 URL 과 같아 무해하다.
 */
export function requestSort(pending: PendingSort | null, next: DataTableSort): PendingSort {
  const key = sortKey(next);
  if (!pending) return { requested: [key], landed: -1, next };
  return { requested: [...pending.requested, key], landed: pending.landed, next };
}

/**
 * URL(sort prop)이 바뀌었을 때 — 따라잡았으면 비우고, 중간 요청이면 위치만 옮기고, 모르는 값이면 비운다.
 * 키(sortKey)를 받는다 — 서버 표는 렌더마다 새 sort 객체를 넘기므로 값이 바뀔 때만 부르도록.
 */
export function reconcileSort(pending: PendingSort | null, currentKey: string): PendingSort | null {
  if (!pending) return null;
  const index = pending.requested.indexOf(currentKey, pending.landed + 1);
  if (index === -1 || index === pending.requested.length - 1) return null;
  return { ...pending, landed: index };
}
