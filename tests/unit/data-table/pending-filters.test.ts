import { describe, expect, it } from 'vitest';

import {
  filtersBase,
  filtersKey,
  isRequestedKey,
  reconcileFilters,
  requestFilters,
} from '@/components/ui/data-table/pending-filters';
import type { FilterCondition } from '@/lib/table/filter';

/** 빠른 필터 바 R1 — URL 에 아직 반영되지 않은 조건 요청 추적 (표 열 필터 빠른 필터 바 §2.4) */
const A: FilterCondition[] = [{ col: 'status', op: 'in', values: ['INACTIVE'] }];
const AB: FilterCondition[] = [{ col: 'status', op: 'in', values: ['INACTIVE', 'SUSPENDED'] }];
const ABC: FilterCondition[] = [
  { col: 'status', op: 'in', values: ['INACTIVE', 'SUSPENDED'] },
  { col: 'name', op: 'has', value: 'kim' },
];

describe('pending-filters', () => {
  it('키는 조건·in 값 순서와 무관하고, 조건이 없으면 빈 문자열', () => {
    expect(filtersKey([])).toBe('');
    expect(filtersKey(ABC)).toBe(filtersKey([...ABC].reverse()));
    expect(filtersKey(AB)).toBe(
      filtersKey([{ col: 'status', op: 'in', values: ['SUSPENDED', 'INACTIVE'] }]),
    );
    expect(filtersKey(A)).not.toBe(filtersKey(AB));
  });

  it('대기 요청이 없으면 URL 조건, 있으면 마지막 요청이 다음 변경의 기준 (빠른 두 번째 체크가 첫 체크를 지우지 않음)', () => {
    expect(filtersBase(null, A)).toBe(A);
    const first = requestFilters(null, A);
    // URL 은 아직 [] — 두 번째 변경은 [] 가 아니라 A 에서 계산된다
    expect(filtersBase(first, [])).toBe(A);
    const second = requestFilters(first, AB);
    expect(filtersBase(second, [])).toBe(AB);
    expect(second.requested).toEqual([filtersKey(A), filtersKey(AB)]);
  });

  it('URL 이 중간 요청을 지나가면 유지, 마지막 요청에 닿으면 비운다', () => {
    const pending = requestFilters(requestFilters(null, A), AB);
    const halfway = reconcileFilters(pending, filtersKey(A));
    expect(halfway).toMatchObject({ landed: 0, next: AB });
    expect(reconcileFilters(halfway, filtersKey(AB))).toBeNull();
    // 라우터가 중간 이동을 건너뛰어도 비운다
    expect(reconcileFilters(pending, filtersKey(AB))).toBeNull();
  });

  it('요청 밖의 값(외부 변경 — 초기화·뒤로 가기)이면 비운다', () => {
    const pending = requestFilters(requestFilters(null, A), AB);
    expect(isRequestedKey(pending, filtersKey(ABC))).toBe(false);
    expect(reconcileFilters(pending, filtersKey(ABC))).toBeNull();
    const halfway = reconcileFilters(pending, filtersKey(A));
    // 이미 지난 중간 값으로 되돌아가도 외부 변경
    expect(isRequestedKey(halfway, filtersKey(A))).toBe(false);
    expect(isRequestedKey(halfway, filtersKey(AB))).toBe(true);
    expect(reconcileFilters(null, filtersKey(A))).toBeNull();
    expect(isRequestedKey(null, '')).toBe(false);
  });
});
