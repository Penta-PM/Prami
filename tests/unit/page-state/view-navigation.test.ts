import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigateView, registerEmptyViewSave } from '@/lib/page-state/view-navigation';

/**
 * navigateView 순번 토큰 (표 열 필터 빠른 필터 바 §2.4 R2): 빈 쿼리 이동은 빈 상태 저장을 기다린 뒤 나가는데,
 * 그 사이 나간 뒤의 이동을 덮으면 안 된다 — 기다리는 사이 다른 요청이 있었으면 버린다(마지막 요청이 최종 URL).
 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const unregisters: (() => void)[] = [];
afterEach(() => {
  while (unregisters.length) unregisters.pop()?.();
});

describe('navigateView 순번 (R2)', () => {
  it('마지막 조건 해제(빈 이동) 직후 다른 조건 적용 → 늦게 끝난 빈 이동은 버리고 최종 URL 은 마지막 동작 결과', async () => {
    const save = deferred();
    unregisters.push(registerEmptyViewSave('/admin/audit', () => save.promise));
    const navigate = vi.fn();

    navigateView('/admin/audit', navigate); // 빈 상태 저장 대기
    navigateView('/admin/audit?f.result.in=FAILURE', navigate); // 바로 나감
    expect(navigate.mock.calls).toEqual([['/admin/audit?f.result.in=FAILURE']]);

    save.resolve();
    await save.promise;
    await Promise.resolve();
    expect(navigate.mock.calls).toEqual([['/admin/audit?f.result.in=FAILURE']]);
  });

  it('다른 요청이 없으면 저장을 기다린 뒤 빈 이동이 나간다', async () => {
    const save = deferred();
    unregisters.push(registerEmptyViewSave('/admin/audit', () => save.promise));
    const navigate = vi.fn();
    navigateView('/admin/audit', navigate);
    expect(navigate).not.toHaveBeenCalled();
    save.resolve();
    await save.promise;
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith('/admin/audit');
  });

  it('빈 이동 두 번이 겹치면 마지막 것만 나간다', async () => {
    const first = deferred();
    const second = deferred();
    const saves = [first.promise, second.promise];
    unregisters.push(registerEmptyViewSave('/pricing', () => saves.shift() as Promise<void>));
    const navigate = vi.fn();
    navigateView('/pricing', navigate);
    navigateView('/pricing', navigate);
    first.resolve();
    second.resolve();
    await Promise.all([first.promise, second.promise]);
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('저장이 필요 없는 이동은 순번과 무관하게 바로 나간다', () => {
    const navigate = vi.fn();
    navigateView('/pricing?q=a', navigate);
    navigateView('/pricing?q=b', navigate);
    expect(navigate.mock.calls).toEqual([['/pricing?q=a'], ['/pricing?q=b']]);
  });
});
