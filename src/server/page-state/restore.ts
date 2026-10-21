import 'server-only';

import type { Db } from '@/db';
import { hrefWithQuery, PAGE_PATHS, type PageKey } from '@/lib/page-state/keys';

import { hasParams, normalizeViewQuery, type Params, type ViewStateActor } from './normalize';
import { readViewState } from './store';

/**
 * 재진입 복원 판정 (page-state-memory §2.2-4·§2.3-2) — Next API(redirect·headers)를 쓰지 않는 순수 판정이라 단위 테스트한다.
 * 화면 RSC 는 `restoreViewState`(./restore-page)로 이 결과를 받아 redirect 하거나 트래커 props 로 넘긴다.
 *
 * - 파라미터 없는 진입 + 저장 쿼리가 파서를 다시 통과한 뒤에도 비어 있지 않음 → redirect(path?query).
 *   저장 쿼리가 비었거나 정규화 후 비면 redirect 하지 않는다(루프 방지 — redirect 대상은 항상 파라미터가 있어 다시 복원하지 않는다).
 * - 파라미터가 명시된 진입은 복원하지 않는다(링크 상태 우선 — 저장은 클라이언트 트래커가 한다).
 * - 지금 보고 있는 화면의 사이드바 링크를 다시 눌러도(같은 경로에서 온 요청) 똑같이 복원한다 — 초기화는 명시적 수단으로만(§6 Plan 정정).
 *   그래서 화면 안에서 빈 쿼리가 되는 이동('필터 초기화'·마지막 칩 제거·1페이지 이동)은 클라이언트가 빈 상태를 **이동 전에** 저장한다
 *   (lib/page-state/view-navigation) — 이동 요청 시점의 저장 쿼리가 '' 라 redirect 하지 않는다.
 * - 스크롤: 저장된 scroll.query 가 현재 정규화 쿼리와 같을 때만 top 을 돌려준다(아니면 null = 맨 위).
 */
export type ViewRestore = {
  /** 복원 redirect 대상 (없으면 null) */
  redirectTo: string | null;
  /** 저장된 쿼리 — 트래커가 같은 값을 다시 저장하지 않도록 */
  savedQuery: string | null;
  /** 복원할 `<main>` 스크롤 위치 (조건이 다르거나 없으면 null) */
  restoreTop: number | null;
};

export type ViewRestoreInput = {
  db: Db;
  userId: string;
  actor: ViewStateActor;
  pageKey: PageKey;
  params: Params;
};

export async function resolveViewRestore({
  db,
  userId,
  actor,
  pageKey,
  params,
}: ViewRestoreInput): Promise<ViewRestore> {
  const path = PAGE_PATHS[pageKey];
  const saved = await readViewState(db, userId, pageKey);
  const explicit = hasParams(params);

  if (!explicit && saved?.query) {
    const query = await normalizeViewQuery(db, actor, pageKey, saved.query);
    if (query)
      return { redirectTo: hrefWithQuery(path, query), savedQuery: saved.query, restoreTop: null };
  }

  let restoreTop: number | null = null;
  if (saved?.scroll) {
    const current = explicit ? await normalizeViewQuery(db, actor, pageKey, params) : '';
    if (current === saved.scroll.query) restoreTop = saved.scroll.top;
  }
  return { redirectTo: null, savedQuery: saved?.query ?? null, restoreTop };
}
