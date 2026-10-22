import { serializeFilters, type FilterCondition } from '@/lib/table/filter';

/**
 * 빠른 필터 바의 '보낸(대기 중) 조건' (표 열 필터 빠른 필터 바 §2.4 R1). pending-sort.ts 와 같은 방식.
 * 조건은 URL(서버 표는 RSC 가 다시 준 filter)이 기준이라, 즉시 적용으로 연달아 바꾸면 URL 이 따라잡기 전의 두 번째 변경이
 * 낡은 URL 에서 계산돼 첫 변경을 지운다. 그래서 아직 URL 에 반영되지 않은 요청을 기억해 다음 변경은 '직전 요청의 결과'에서 계산한다.
 *
 * - requested: 요청한 조건 키 순서, landed: URL 이 따라잡은 마지막 요청 위치(-1 = 아직 없음), next: 마지막 요청 조건
 * - URL 이 마지막 요청까지 따라잡으면 비운다. 중간 요청을 지나가는 중이면 유지한다.
 * - URL 이 요청 목록에 없는 값으로 바뀌면(필터 초기화·뒤로 가기·서버 정규화 등 외부 변경) 비운다 — 외부 상태가 이긴다.
 * React·라우터에 의존하지 않는 순수 함수 — 빠른 필터 바가 상태로 들고 다닌다.
 */
export type PendingFilters = {
  requested: readonly string[];
  landed: number;
  next: readonly FilterCondition[];
};

/**
 * 조건 목록의 비교 키 — 순서·`in` 값 순서와 무관(서버가 다시 만든 조건과 같은 집합이면 같은 키).
 * URL 직렬화(serializeFilters)를 쓰므로 같은 열·연산자가 두 번이면 둘 다 들어간다(실제로는 생기지 않음).
 */
export function filtersKey(conds: readonly FilterCondition[]): string {
  const canonical = conds.map((cond) =>
    cond.op === 'in' ? { ...cond, values: [...cond.values].sort() } : cond,
  );
  return serializeFilters(canonical)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('&');
}

/** 다음 변경 계산의 기준 — 대기 중인 요청이 있으면 그 결과, 없으면 URL 상태 */
export function filtersBase(
  pending: PendingFilters | null,
  current: readonly FilterCondition[],
): readonly FilterCondition[] {
  return pending ? pending.next : current;
}

/** next 를 요청했을 때의 대기 상태. 요청이 지금 URL 과 같아도 비우지 않는다 — 중간 요청이 뒤늦게 반영될 수 있어서다 */
export function requestFilters(
  pending: PendingFilters | null,
  next: readonly FilterCondition[],
): PendingFilters {
  const key = filtersKey(next);
  if (!pending) return { requested: [key], landed: -1, next };
  return { requested: [...pending.requested, key], landed: pending.landed, next };
}

/** URL 조건 키가 대기 중 요청 가운데 하나인가 (외부 변경 판별) */
export function isRequestedKey(pending: PendingFilters | null, currentKey: string): boolean {
  return pending ? pending.requested.indexOf(currentKey, pending.landed + 1) !== -1 : false;
}

/** URL 조건이 바뀌었을 때 — 따라잡았으면 비우고, 중간 요청이면 위치만 옮기고, 모르는 값이면 비운다 */
export function reconcileFilters(
  pending: PendingFilters | null,
  currentKey: string,
): PendingFilters | null {
  if (!pending) return null;
  const index = pending.requested.indexOf(currentKey, pending.landed + 1);
  if (index === -1 || index === pending.requested.length - 1) return null;
  return { ...pending, landed: index };
}
