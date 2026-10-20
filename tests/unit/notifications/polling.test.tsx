import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #31 PR-2 폴링 (스펙 §4 전달 방식): 마운트 1회, visible 동안 60초 간격, hidden 이면 interval 정지(요청 0),
 * focus·visibilitychange(visible)·드롭다운 열림 시 즉시 조회. 오류는 상태에만 남는다.
 */
vi.mock('@/features/notifications/actions', () => ({
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));

const { useNotifications, NOTIFICATION_POLL_MS } =
  await import('@/features/notifications/useNotifications');

const fetchMock = vi.fn();
let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ unreadCount: 1, items: [] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  // jsdom 기본값(프로토타입 getter)으로 되돌린다
  delete (document as { visibilityState?: unknown }).visibilityState;
});

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useNotifications 폴링', () => {
  it('간격은 60초다', () => {
    expect(NOTIFICATION_POLL_MS).toBe(60_000);
  });

  it('마운트 시 1회, visible 동안 60초마다 조회한다', async () => {
    const { result } = renderHook(() => useNotifications(false));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.status).toBe('ready');
    await flush(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('탭이 hidden 이면 interval 을 멈추고(요청 0), visible 로 돌아오면 즉시 조회 후 재개한다', async () => {
    renderHook(() => useNotifications(false));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setVisibility('hidden'));
    await flush(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // hidden 중 focus 이벤트도 조회하지 않는다
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('처음부터 hidden 이면 마운트 1회 뒤 interval 이 돌지 않는다', async () => {
    visibility = 'hidden';
    renderHook(() => useNotifications(false));
    await flush(3 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('window focus 시 즉시 조회한다', async () => {
    renderHook(() => useNotifications(false));
    await flush();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('드롭다운을 열 때 즉시 조회한다', async () => {
    const { rerender } = renderHook(({ open }) => useNotifications(open), {
      initialProps: { open: false },
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ open: true });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('언마운트하면 더 조회하지 않는다', async () => {
    const { unmount } = renderHook(() => useNotifications(false));
    await flush();
    unmount();
    await flush(3 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('503·네트워크 오류는 status=error 로만 남고, 이전 개수는 유지된다', async () => {
    const { result } = renderHook(() => useNotifications(false));
    await flush();
    expect(result.current.unreadCount).toBe(1);
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await flush(60_000);
    expect(result.current.status).toBe('error');
    expect(result.current.unreadCount).toBe(1);
    fetchMock.mockImplementation(async () => {
      throw new TypeError('network');
    });
    await flush(60_000);
    expect(result.current.status).toBe('error');
    expect(result.current.unreadCount).toBe(1);
  });

  it('API 500(예: notifications 테이블 미적용) → 오류 상태, 다음 주기에 재시도해 회복(migration-apply-lan §2-3)', async () => {
    const { result } = renderHook(() => useNotifications(false));
    await flush();
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await flush(60_000);
    expect(result.current.status).toBe('error');
    const calls = fetchMock.mock.calls.length;
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ unreadCount: 3, items: [] }),
    }));
    await flush(60_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    expect(result.current.status).not.toBe('error');
    expect(result.current.unreadCount).toBe(3);
  });
});
