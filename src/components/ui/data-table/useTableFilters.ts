'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import {
  parseFilterParams,
  withFiltersQuery,
  type ColumnFilterDef,
  type FilterCondition,
} from '@/lib/table/filter';

/** 표 하나의 열 필터 상태 — URL(useUrlFilters)·컴포넌트 상태(useStateFilters) 어느 쪽이든 같은 모양 */
export type TableFilterState = {
  filters: readonly FilterCondition[];
  setFilters: (next: readonly FilterCondition[]) => void;
};

/**
 * 클라이언트 표의 열 필터를 URL `f.<col>.<op>` 에 둔다 (표 열 필터 스펙 §2.2).
 * - 읽기: useSearchParams → parseFilterParams(defs) — 화이트리스트 밖 열·연산자, 한도·형식 위반 조건은 버린다.
 * - 쓰기: router.replace(경로 + withFiltersQuery) — 히스토리 누적 없음, 스크롤 유지. `page` 는 지우고(1페이지)
 *   그 밖의 파라미터(`family` 탭 등)는 순서대로 두며 `sort`·`dir` 는 맨 뒤.
 * 서버 표(A-2)는 같은 코덱을 서버에서 파싱하므로 이 훅의 setFilters 를 그대로 쓰면 된다(router.replace 가 RSC 를 다시 받는다).
 * 이 표들이 들어간 페이지는 모두 인증 쿠키를 읽는 동적 렌더라 useSearchParams 가 SSR 에서도 실제 값을 준다(하이드레이션 일치).
 *
 * @param defs 메모된 화이트리스트(filterDefsOf) — 바뀌면 다시 파싱한다
 */
export function useUrlFilters(defs: Readonly<Record<string, ColumnFilterDef>>): TableFilterState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? '';
  const filters = useMemo(() => parseFilterParams(new URLSearchParams(query), defs), [query, defs]);
  const setFilters = useCallback(
    (next: readonly FilterCondition[]) => {
      router.replace(`${pathname}${withFiltersQuery(query, next)}`, { scroll: false });
    },
    [router, pathname, query],
  );
  return { filters, setFilters };
}

/** 모달 안 표(내 견적 목록)용 — 모달은 URL 상태가 아니므로 컴포넌트 상태에 둔다 (§2.2 예외) */
export function useStateFilters(): TableFilterState {
  const [filters, setState] = useState<readonly FilterCondition[]>([]);
  const setFilters = useCallback((next: readonly FilterCondition[]) => setState([...next]), []);
  return { filters, setFilters };
}
