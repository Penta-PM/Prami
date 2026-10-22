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

/**
 * 대기 중인(디바운스 중인) 열 필터 변경 먼저 반영 (표 열 필터 빠른 필터 바 §6 #7). 서버 표의 enum 체크는 400ms 디바운스라,
 * 그 사이 같은 표의 다른 이동(정렬·페이지·제품군 탭·페이지 필터)을 누르면 그 이동의 href 에는 체크가 없다 →
 * 이동하기 전에 대기 중인 조건을 그 href 에 합쳐(flush) 둘 다 남긴다. 버리는 것은 바가 사라질 때(화면 이탈)와 외부 URL 변경뿐.
 *
 * - 서버 표가 마운트돼 있는 동안 그 경로의 flush 함수(href → 대기 중 조건을 합친 href, 대기 중이 없으면 그대로)를 등록한다.
 * - navigateView·ViewStateLink 는 이동 직전에 flushPendingView 로 href 를 바꾼다. flush 는 대기 중 조건을 '보낸 요청'으로 옮기고 타이머를 끈다.
 */
type ViewFlush = (href: string) => string;

const viewFlushes = new Map<string, ViewFlush>();

/** 경로의 대기 중 조건 flush 함수를 등록한다. 해제 함수를 돌려준다(그 사이 다른 등록이 덮었으면 건드리지 않는다) */
export function registerViewFlush(path: string, flush: ViewFlush): () => void {
  viewFlushes.set(path, flush);
  return () => {
    if (viewFlushes.get(path) === flush) viewFlushes.delete(path);
  };
}

/** 이동 직전 — href 경로에 대기 중인 열 필터 변경이 있으면 합친 href, 없으면 그대로 */
export function flushPendingView(href: string): string {
  const flush = viewFlushes.get(splitHref(href).path);
  return flush ? flush(href) : href;
}

/**
 * 이동 순번 (표 열 필터 빠른 필터 바 §2.4 R2). 빈 쿼리 이동은 저장을 기다리는 동안 뒤의 이동(즉시 적용 필터 등)이 먼저 나갈 수 있다 —
 * 저장이 끝난 뒤 낡은 빈 이동이 새 이동을 덮지 않도록, 이동을 요청할 때마다 순번을 올리고 기다린 이동은 자기 순번이 최신일 때만 나간다.
 * 화면이 하나뿐인 클라이언트 전역 순번이다(경로와 무관 — 어떤 이동이든 나중 요청이 이긴다).
 */
let navigationSeq = 0;

/**
 * href 로 이동 — 같은 표에 대기 중인 열 필터 변경이 있으면 먼저 합친다(flushPendingView). 빈 상태가 되는 이동이면 빈 상태 저장을 기다린 뒤, 아니면 바로 navigate(href).
 * 기다리는 사이 다른 navigateView 요청이 있었으면 이 이동은 버린다(R2 — 마지막 요청이 최종 URL).
 */
export function navigateView(target: string, navigate: (href: string) => void): void {
  const href = flushPendingView(target);
  const seq = ++navigationSeq;
  const pending = beforeViewNavigation(href);
  if (!pending) {
    navigate(href);
    return;
  }
  void pending.then(() => {
    if (seq === navigationSeq) navigate(href);
  });
}
