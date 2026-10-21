import { describe, expect, it } from 'vitest';

import {
  reconcileSort,
  requestSort,
  sortBase,
  sortKey,
} from '@/components/ui/data-table/pending-sort';

/** 헤더 빠른 연속 클릭 — URL 에 아직 반영되지 않은 정렬 요청 추적 (BL-2, page-state-memory §6) */
const ASC = { id: 'email', dir: 'asc' } as const;
const DESC = { id: 'email', dir: 'desc' } as const;

describe('pending-sort', () => {
  it('대기 요청이 없으면 URL 상태, 있으면 마지막 요청이 기준', () => {
    expect(sortBase(null, ASC)).toBe(ASC);
    expect(sortBase(requestSort(null, DESC), ASC)).toBe(DESC);
    expect(sortKey(null)).toBe('');
    expect(sortKey(DESC)).toBe('email:desc');
  });

  it('URL 이 중간 요청을 지나가면 유지, 마지막 요청에 닿으면 비운다', () => {
    const pending = requestSort(requestSort(null, ASC), DESC);
    const halfway = reconcileSort(pending, sortKey(ASC));
    expect(halfway).toMatchObject({ landed: 0, next: DESC });
    expect(reconcileSort(halfway, sortKey(DESC))).toBeNull();
    // 라우터가 중간 이동을 건너뛰고 마지막으로 바로 가도 비운다
    expect(reconcileSort(pending, sortKey(DESC))).toBeNull();
  });

  it('요청 밖의 값(외부 변경)이면 비우고, 이미 지난 중간 값으로 되돌아가도 외부 변경으로 본다', () => {
    const pending = requestSort(requestSort(null, ASC), DESC);
    expect(reconcileSort(pending, sortKey({ id: 'name', dir: 'asc' }))).toBeNull();
    const halfway = reconcileSort(pending, sortKey(ASC));
    expect(reconcileSort(halfway, sortKey(null))).toBeNull();
    expect(reconcileSort(null, sortKey(ASC))).toBeNull();
  });

  it('한 바퀴(오름 → 내림 → 해제) 요청은 중간 값이 늦게 와도 순서대로 따라간다', () => {
    const pending = requestSort(requestSort(requestSort(null, ASC), DESC), null);
    const first = reconcileSort(pending, sortKey(ASC));
    const second = reconcileSort(first, sortKey(DESC));
    expect(second).toMatchObject({ landed: 1, next: null });
    expect(reconcileSort(second, sortKey(null))).toBeNull();
  });
});
