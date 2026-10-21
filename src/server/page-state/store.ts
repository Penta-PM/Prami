import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '@/db';
import { userViewStates, type ViewScroll } from '@/db/schema';
import { byteLength, isPageKey, VIEW_QUERY_MAX_BYTES, type PageKey } from '@/lib/page-state/keys';

/**
 * 조회 상태 저장소 (page-state-memory §2.1-1·§2.2·§2.3) — `user_view_states` 읽기·쓰기는 이 모듈만 한다.
 * - 모든 함수는 userId 를 인자로 받고 `user_id = userId` 행만 읽고 쓴다. userId 는 호출하는 쪽(액션·RSC)이 세션에서만 정한다(§2.7-2).
 * - page_key 화이트리스트 밖이면 쓰지 않고 읽지도 않는다. 쿼리는 2KB 를 넘으면 쓰지 않고, 읽을 때도 넘으면 버린다(변조 방어).
 * - 저장 쿼리는 이미 정규화된 값이어야 한다(normalizeViewQuery) — 여기서는 크기·형식만 본다. 복원 쪽이 파서를 다시 통과시킨다.
 */
export type StoredViewState = { query: string; scroll: ViewScroll | null };

/** 스크롤 상한 — 화면 높이와 무관하게 비정상 값은 버린다 */
export const VIEW_SCROLL_TOP_MAX = 10_000_000;

const scrollSchema = z.object({
  query: z.string().refine((value) => byteLength(value) <= VIEW_QUERY_MAX_BYTES),
  top: z.number().int().min(0).max(VIEW_SCROLL_TOP_MAX),
});

export type WriteResult = 'saved' | 'rejected';

/** 저장할 수 있는 쿼리인가 — 문자열·2KB 이하·앞에 ? 없음 */
export function isStorableQuery(query: unknown): query is string {
  return (
    typeof query === 'string' && !query.startsWith('?') && byteLength(query) <= VIEW_QUERY_MAX_BYTES
  );
}

/** 저장된 상태 (없거나·키가 화이트리스트 밖이면 null). 변조된 쿼리(2KB 초과 등)는 ''·변조된 스크롤은 null 로 버린다 */
export async function readViewState(
  db: Db,
  userId: string,
  pageKey: string,
): Promise<StoredViewState | null> {
  if (!isPageKey(pageKey)) return null;
  const [row] = await db
    .select({ query: userViewStates.query, scroll: userViewStates.scroll })
    .from(userViewStates)
    .where(and(eq(userViewStates.userId, userId), eq(userViewStates.pageKey, pageKey)));
  if (!row) return null;
  const scroll = scrollSchema.safeParse(row.scroll);
  return {
    query: isStorableQuery(row.query) ? row.query : '',
    scroll: scroll.success ? scroll.data : null,
  };
}

/** 마지막 조회 쿼리 저장 (upsert). '' = 빈 상태(필터 초기화). 스크롤은 건드리지 않는다 */
export async function writeViewQuery(
  db: Db,
  userId: string,
  pageKey: PageKey | string,
  query: string,
): Promise<WriteResult> {
  if (!isPageKey(pageKey) || !isStorableQuery(query)) return 'rejected';
  await db
    .insert(userViewStates)
    .values({ userId, pageKey, query })
    .onConflictDoUpdate({
      target: [userViewStates.userId, userViewStates.pageKey],
      set: { query, updatedAt: new Date() },
    });
  return 'saved';
}

/** 스크롤 위치 저장 (upsert). 행이 없으면 그 쿼리로 새 행을 만든다(스크롤 저장 시점의 조건 = 현재 조건) */
export async function writeViewScroll(
  db: Db,
  userId: string,
  pageKey: PageKey | string,
  scroll: ViewScroll,
): Promise<WriteResult> {
  const parsed = scrollSchema.safeParse(scroll);
  if (!isPageKey(pageKey) || !parsed.success || !isStorableQuery(parsed.data.query))
    return 'rejected';
  await db
    .insert(userViewStates)
    .values({ userId, pageKey, query: parsed.data.query, scroll: parsed.data })
    .onConflictDoUpdate({
      target: [userViewStates.userId, userViewStates.pageKey],
      set: { scroll: parsed.data, updatedAt: new Date() },
    });
  return 'saved';
}

/** 본인의 조회 상태 전부 삭제 (전역 초기화 — page-state-memory §2.6-3). 지운 행 수 */
export async function clearViewStates(db: Db, userId: string): Promise<number> {
  const rows = await db
    .delete(userViewStates)
    .where(eq(userViewStates.userId, userId))
    .returning({ key: userViewStates.pageKey });
  return rows.length;
}
