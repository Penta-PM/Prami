import { useMemo, useSyncExternalStore } from 'react';
import { vi } from 'vitest';

/**
 * next/navigation 테스트 더블 — URL 검색 파라미터를 메모리에 두고 router.replace/push 가 바꾸면 useSearchParams 구독자가 다시 렌더한다.
 * 사용: `vi.mock('next/navigation', async () => (await import('../../helpers/next-navigation')).navigationModule);`
 * 테스트에서는 같은 모듈의 `navigation` 으로 replace 호출·현재 쿼리를 확인하고, beforeEach 에서 `navigation.reset()` 한다.
 */
let pathname = '/';
let search = '';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function setHref(href: string) {
  const index = href.indexOf('?');
  pathname = index >= 0 ? href.slice(0, index) : href;
  search = index >= 0 ? href.slice(index + 1) : '';
  notify();
}

const replace = vi.fn((href: string) => setHref(href));
const push = vi.fn((href: string) => setHref(href));
const refresh = vi.fn();
const router = { replace, push, refresh, back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };

export const navigation = {
  replace,
  push,
  refresh,
  /** 현재 쿼리(앞의 ? 없음) */
  search: () => search,
  pathname: () => pathname,
  /** 테스트 시작 상태 — 경로·쿼리 지정, 호출 기록 초기화 */
  reset(path = '/', query = '') {
    pathname = path;
    search = query;
    replace.mockClear();
    push.mockClear();
    refresh.mockClear();
    notify();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const navigationModule = {
  useRouter: () => router,
  usePathname: () => useSyncExternalStore(subscribe, () => pathname),
  useSearchParams: () => {
    const query = useSyncExternalStore(subscribe, () => search);
    return useMemo(() => new URLSearchParams(query), [query]);
  },
};
