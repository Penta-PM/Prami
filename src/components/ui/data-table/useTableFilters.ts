'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { navigateView } from '@/lib/page-state/view-navigation';
import {
  parseFilterParams,
  withFiltersQuery,
  type ColumnFilterDef,
  type FilterCondition,
} from '@/lib/table/filter';
import { parseSortParams, withSortQuery } from '@/lib/table/sort-param';

import type { DataTableSort } from './types';

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
 * 다음 쿼리가 비면(마지막 조건 해제) navigateView 가 그 화면의 빈 상태 저장을 기다린 뒤 이동한다(page-state-memory §6 — 파라미터 없는 요청은 복원되므로).
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
      navigateView(`${pathname}${withFiltersQuery(query, next)}`, (href) =>
        router.replace(href, { scroll: false }),
      );
    },
    [router, pathname, query],
  );
  return { filters, setFilters };
}

/** 클라이언트 표의 URL 상태 — 열 필터 + 정렬 + 둘을 한 번에 지우는 '필터 초기화' */
export type UrlTableState = TableFilterState & {
  sort: DataTableSort;
  setSort: (next: DataTableSort) => void;
  /** 열 필터·정렬을 함께 해제 (router.replace 1회 — 두 번 바꾸면 두 번째가 첫 번째 결과를 모른다) */
  reset: () => void;
};

/**
 * 클라이언트 표의 열 필터·정렬을 URL 에 둔다 (page-state-memory §2.2-6 — #32 §5 "새로고침 시 해제" 개정).
 * 정렬은 `sort`·`dir`(맨 뒤), 화이트리스트(sortIds) 밖 열·잘못된 방향은 parseSortParams 규칙대로 버린다.
 * URL 이 상태라 새로고침·재진입(서버 저장 복원) 뒤에도 유지된다. 다른 파라미터(`family` 탭 등)는 그대로 둔다.
 *
 * @param defs 메모된 열 필터 화이트리스트(filterDefsOf)
 * @param sortIds 정렬 가능한 열 id (모듈 상수 — 서버 정규화와 같은 목록)
 */
export function useUrlTableState(
  defs: Readonly<Record<string, ColumnFilterDef>>,
  sortIds: readonly string[],
): UrlTableState {
  const router = useRouter();
  const pathname = usePathname();
  const { filters, setFilters } = useUrlFilters(defs);
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? '';
  const sort = useMemo<DataTableSort>(
    () => parseSortParams(new URLSearchParams(query), sortIds) ?? null,
    [query, sortIds],
  );
  const setSort = useCallback(
    (next: DataTableSort) => {
      navigateView(`${pathname}${withSortQuery(query, next)}`, (href) =>
        router.replace(href, { scroll: false }),
      );
    },
    [router, pathname, query],
  );
  const reset = useCallback(() => {
    const cleared = withFiltersQuery(query, []);
    navigateView(`${pathname}${withSortQuery(cleared, null)}`, (href) =>
      router.replace(href, { scroll: false }),
    );
  }, [router, pathname, query]);
  return { filters, setFilters, sort, setSort, reset };
}

/** 모달 안 표(내 견적 목록)용 — 모달은 URL 상태가 아니므로 컴포넌트 상태에 둔다 (§2.2 예외) */
export function useStateFilters(): TableFilterState {
  const [filters, setState] = useState<readonly FilterCondition[]>([]);
  const setFilters = useCallback((next: readonly FilterCondition[]) => setState([...next]), []);
  return { filters, setFilters };
}
