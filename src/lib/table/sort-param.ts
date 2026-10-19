// 클라이언트(필터 UI·표 헤더)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';

import type { SortDir } from './compare';

/**
 * 서버 정렬 URL 상태 (#32 스펙 §3): `?…&sort=<colId>&dir=asc|desc`.
 * sort 는 표마다 정한 화이트리스트(z.enum)로만 받는다 — ORDER BY 는 colId → SQL 맵으로만 만들고 문자열 보간은 하지 않는다.
 */
export type SortState<Id extends string = string> = { id: Id; dir: SortDir };

type Params = Record<string, string | string[] | undefined>;

const dirSchema = z.enum(['asc', 'desc']).catch('asc');

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** URL 검색 파라미터 → 정렬. sort 가 allowed 에 없으면 undefined(무시 → 기본 정렬). dir 이 asc|desc 가 아니면 'asc'. zod enum + catch 로 검증 (문자열 보간 금지의 1차 방어) */
export function parseSortParams<Id extends string>(
  params: Params,
  allowed: readonly Id[],
): SortState<Id> | undefined {
  if (allowed.length === 0) return undefined;
  const id = z
    .enum(allowed as unknown as [Id, ...Id[]])
    .optional()
    .catch(undefined)
    .parse(first(params, 'sort'));
  if (id === undefined) return undefined;
  return { id, dir: dirSchema.parse(first(params, 'dir')) };
}

/** 쿼리스트링('' 또는 '?a=b')의 **맨 뒤**에 &sort=<id>&dir=<dir> 를 붙여 반환. sort 없으면 그대로 */
export function appendSortParams(query: string, sort: SortState | undefined): string {
  if (!sort) return query;
  const tail = new URLSearchParams({ sort: sort.id, dir: sort.dir }).toString();
  return query === '' || query === '?' ? `?${tail}` : `${query}&${tail}`;
}
