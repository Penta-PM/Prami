/**
 * 화면 안 이동의 '빈 상태 먼저 저장' (page-state-memory §6 — Plan 정정, B-1).
 * 파라미터 없는 진입은 사이드바 재클릭을 포함해 항상 저장 상태로 복원된다(RSC restoreViewState). 그래서 화면 안에서
 * '필터 초기화'·마지막 조건 해제·1페이지 이동처럼 **빈 쿼리**가 되는 이동은 그 빈 상태를 **이동 전에** 저장해야
 * 이동 요청이 이전 조건으로 redirect 되지 않는다.
 *
 * - 화면의 ViewStateTracker 가 마운트돼 있는 동안 그 경로의 '빈 상태 저장' 함수를 등록한다(대기 중인 디바운스 저장 취소 + '' 저장).
 * - 공용 URL 갱신 경로(useUrlFilters·useUrlTableState·서버 표 필터·페이지 링크)는 navigateView 로 이동한다:
 *   다음 href 의 쿼리가 비었고 그 경로에 등록된 함수가 있으면 저장을 기다린 뒤 이동, 아니면 바로 이동(비어 있지 않은 이동은 그대로 — 트래커가 디바운스 저장).
 * 클라이언트 전용 상태(모듈 변수) — 서버에서는 아무것도 등록되지 않는다. React·서버 액션에 의존하지 않는 순수 모듈이라 단위 테스트한다.
 */
type EmptySave = () => Promise<void>;

const emptySaves = new Map<string, EmptySave>();

/** 경로의 빈 상태 저장 함수를 등록한다. 해제 함수를 돌려준다(그 사이 다른 등록이 덮었으면 건드리지 않는다) */
export function registerEmptyViewSave(path: string, save: EmptySave): () => void {
  emptySaves.set(path, save);
  return () => {
    if (emptySaves.get(path) === save) emptySaves.delete(path);
  };
}

/** href → 경로·쿼리(앞의 ? 없음, 해시 제외) */
export function splitHref(href: string): { path: string; query: string } {
  const withoutHash = href.split('#', 1)[0] ?? '';
  const index = withoutHash.indexOf('?');
  return index >= 0
    ? { path: withoutHash.slice(0, index), query: withoutHash.slice(index + 1) }
    : { path: withoutHash, query: '' };
}

/**
 * 이동 전에 기다려야 할 저장 — 다음 href 쿼리가 비었고 그 경로에 트래커가 등록돼 있으면 저장 Promise(실패해도 resolve),
 * 아니면 null(바로 이동).
 */
export function beforeViewNavigation(href: string): Promise<void> | null {
  const { path, query } = splitHref(href);
  if (query) return null;
  const save = emptySaves.get(path);
  if (!save) return null;
  return save().catch(() => undefined);
}

/** href 로 이동 — 빈 상태가 되는 이동이면 빈 상태 저장을 기다린 뒤, 아니면 바로 navigate(href) */
export function navigateView(href: string, navigate: (href: string) => void): void {
  const pending = beforeViewNavigation(href);
  if (!pending) {
    navigate(href);
    return;
  }
  void pending.then(() => navigate(href));
}
