import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationItemView, NotificationsResponse } from '@/features/notifications/types';

/**
 * #31 PR-2 NotificationBell (스펙 §4 UI): 접근성 이름·배지, 로딩/빈/오류 상태, 항목 클릭(읽음 → 이동 → 닫기),
 * 모두 읽음, 키보드(Escape·바깥 클릭·Tab 이탈·Modal 우선), 중요 배지, 절대 시각.
 * UX PR-C2: 헤더 챗봇 버튼·도킹 패널이 없어져 #31 챗 패널 상호 배제 결합을 걷어 냈다 — 알림은 챗 컨텍스트 없이 단독으로 동작한다.
 * fetch·서버 액션·라우터는 모킹 — 서버 계약(NotificationsResponse)만 따른다.
 */
const pushMock = vi.fn();
const markReadMock = vi.fn();
const markAllMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
}));
vi.mock('@/features/notifications/actions', () => ({
  markNotificationReadAction: (input: { id: string }) => markReadMock(input),
  markAllNotificationsReadAction: () => markAllMock(),
}));

const { NotificationBell, notificationBellLabel } =
  await import('@/features/notifications/NotificationBell');

const fetchMock = vi.fn();

function item(partial: Partial<NotificationItemView> = {}): NotificationItemView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'notice.created',
    title: '새 공지: 10월 가격 개편',
    body: '본문 요약',
    href: '/notices/11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-12T01:05:00.000Z',
    read: false,
    important: false,
    ...partial,
  };
}

function okResponse(body: NotificationsResponse) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** 모든 조회가 같은 응답을 돌려준다 */
function serve(body: NotificationsResponse) {
  fetchMock.mockImplementation(async () => okResponse(body));
}

function renderShell() {
  return render(
    <>
      <button type="button">바깥 버튼</button>
      <NotificationBell />
      {/* 실제 헤더처럼 종 뒤에도 포커스 가능한 요소(사용자 설정·로그아웃)가 있다 */}
      <button type="button">뒤 버튼</button>
      <p>본문 영역</p>
    </>,
  );
}

async function openDropdown(name: string | RegExp = /^알림/) {
  const bell = await screen.findByRole('button', { name });
  await userEvent.click(bell);
  return { bell, dialog: await screen.findByRole('dialog', { name: '알림' }) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  pushMock.mockReset();
  markReadMock.mockReset();
  markAllMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('notificationBellLabel', () => {
  it('0 → "알림", N → "알림 N개 안 읽음", 99 초과 → "알림 99개 이상 안 읽음"', () => {
    expect(notificationBellLabel(0)).toBe('알림');
    expect(notificationBellLabel(1)).toBe('알림 1개 안 읽음');
    expect(notificationBellLabel(99)).toBe('알림 99개 안 읽음');
    expect(notificationBellLabel(100)).toBe('알림 99개 이상 안 읽음');
  });
});

describe('NotificationBell 버튼·배지', () => {
  it('첫 렌더는 배지 없는 "알림" (SSR 배지 없음) — 조회 뒤에 개수를 그린다', async () => {
    serve({ unreadCount: 1, items: [item()] });
    renderShell();
    const bell = screen.getByRole('button', { name: '알림' });
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog');
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    await screen.findByRole('button', { name: '알림 1개 안 읽음' });
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications?limit=20', { cache: 'no-store' });
  });

  it('0 이면 배지를 렌더하지 않는다', async () => {
    serve({ unreadCount: 0, items: [] });
    renderShell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('1 이면 배지 "1"(aria-hidden), 이름 "알림 1개 안 읽음"', async () => {
    serve({ unreadCount: 1, items: [item()] });
    renderShell();
    const bell = await screen.findByRole('button', { name: '알림 1개 안 읽음' });
    const badge = within(bell).getByTestId('notification-badge');
    expect(badge).toHaveTextContent(/^1$/);
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('100 이면 배지 "99+", 이름 "알림 99개 이상 안 읽음"', async () => {
    serve({ unreadCount: 100, items: [item()] });
    renderShell();
    const bell = await screen.findByRole('button', { name: '알림 99개 이상 안 읽음' });
    expect(within(bell).getByTestId('notification-badge')).toHaveTextContent(/^99\+$/);
  });

  it('봉투 응답({ ok, data })도 받는다', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { unreadCount: 2, items: [item()] } }),
    }));
    renderShell();
    await screen.findByRole('button', { name: '알림 2개 안 읽음' });
  });
});

describe('NotificationBell 드롭다운 상태', () => {
  it('로딩: "불러오는 중…" + aria-busy, 응답 뒤 빈 상태 "새 알림이 없습니다."', async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: '알림' }));
    const dialog = screen.getByRole('dialog', { name: '알림' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByText('불러오는 중…')).toBeInTheDocument();
    await act(async () => resolve(okResponse({ unreadCount: 0, items: [] })));
    expect(await within(dialog).findByText('새 알림이 없습니다.')).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute('aria-busy');
    expect(within(dialog).getByRole('button', { name: '모두 읽음' })).toBeDisabled();
  });

  it('오류(503): 열려 있으면 role=alert 문구 + 다시 시도 → 목록', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    renderShell();
    const { dialog } = await openDropdown('알림');
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('알림을 불러오지 못했습니다.');
    serve({ unreadCount: 1, items: [item()] });
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await within(dialog).findByRole('link', { name: /10월 가격 개편/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('폴링 오류는 드롭다운이 닫혀 있으면 드러나지 않는다 (마지막 개수 유지)', async () => {
    serve({ unreadCount: 3, items: [item()] });
    const { unmount } = renderShell();
    await screen.findByRole('button', { name: '알림 3개 안 읽음' });
    fetchMock.mockImplementation(async () => {
      throw new TypeError('network');
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '알림 3개 안 읽음' })).toBeInTheDocument();
    unmount();
  });
});

describe('NotificationBell 항목', () => {
  it('유형 아이콘·제목·본문·절대 시각(YYYY-MM-DD HH:mm, 상대시간 없음), 안 읽음 표시(sr-only)', async () => {
    serve({
      unreadCount: 1,
      items: [
        item(),
        item({
          id: '22222222-2222-4222-8222-222222222222',
          type: 'policy.applied',
          title: '가격정책이 갱신되었습니다',
          body: '반영 12건',
          href: '/pricing',
          read: true,
        }),
      ],
    });
    renderShell();
    const { dialog } = await openDropdown();
    const links = await within(dialog).findAllByRole('link');
    expect(links).toHaveLength(2);
    const [unread, read] = links as [HTMLElement, HTMLElement];
    expect(unread).toHaveTextContent('새 공지: 10월 가격 개편');
    expect(unread).toHaveTextContent('본문 요약');
    // 2026-10-12T01:05Z = KST 10:05
    expect(unread).toHaveTextContent('2026-10-12 10:05');
    expect(dialog).not.toHaveTextContent(/전$|분 전|시간 전|일 전|방금/);
    expect(within(unread).getByText('안 읽음')).toHaveClass('sr-only');
    expect(unread).toHaveAttribute('data-unread', 'true');
    expect(read).not.toHaveAttribute('data-unread');
    expect(within(read).queryByText('안 읽음')).not.toBeInTheDocument();
    expect(read).toHaveAttribute('href', '/pricing');
  });

  it('중요 공지는 ImportantBadge("중요")를 보여 주고, 일반 항목은 보여 주지 않는다', async () => {
    serve({
      unreadCount: 2,
      items: [
        item({ important: true, title: '새 공지: 긴급' }),
        item({ id: '33333333-3333-4333-8333-333333333333', title: '새 공지: 일반' }),
      ],
    });
    renderShell();
    const { dialog } = await openDropdown();
    const badge = within(await within(dialog).findByRole('link', { name: /긴급/ })).getByText(
      '중요',
    );
    expect(badge).toBeInTheDocument();
    // 미읽음 보라 틴트 위 axe 대비(#52 QA → #31 PR-3 공용 배지 red-600)
    expect(badge).toHaveClass('text-red-600');
    expect(badge).not.toHaveClass('text-red-500');
    expect(
      within(within(dialog).getByRole('link', { name: /일반/ })).queryByText('중요'),
    ).not.toBeInTheDocument();
  });

  it('제목·본문은 텍스트로만 렌더한다 (HTML 해석 없음)', async () => {
    serve({ unreadCount: 1, items: [item({ title: '<b>굵게</b>', body: '<img src=x>' })] });
    renderShell();
    const { dialog } = await openDropdown();
    const link = await within(dialog).findByRole('link');
    expect(link).toHaveTextContent('<b>굵게</b>');
    expect(link.querySelector('b, img')).toBeNull();
  });

  it('항목 클릭 → 읽음 처리 → router.push(href) → 닫힘, 배지가 줄어든다', async () => {
    serve({ unreadCount: 2, items: [item()] });
    markReadMock.mockResolvedValue({ ok: true, data: { unreadCount: 1 } });
    renderShell();
    const { dialog } = await openDropdown('알림 2개 안 읽음');
    await userEvent.click(await within(dialog).findByRole('link', { name: /10월 가격 개편/ }));
    expect(markReadMock).toHaveBeenCalledWith({ id: '11111111-1111-4111-8111-111111111111' });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/notices/11111111-1111-4111-8111-111111111111'),
    );
    expect(markReadMock.mock.invocationCallOrder[0]!).toBeLessThan(
      pushMock.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '알림 1개 안 읽음' })).toBeInTheDocument();
  });

  it('모두 읽음 → 배지 0(이름 "알림") + 버튼 disabled', async () => {
    serve({
      unreadCount: 2,
      items: [item(), item({ id: '44444444-4444-4444-8444-444444444444' })],
    });
    markAllMock.mockResolvedValue({ ok: true, data: { unreadCount: 0 } });
    renderShell();
    const { dialog } = await openDropdown('알림 2개 안 읽음');
    const markAll = within(dialog).getByRole('button', { name: '모두 읽음' });
    await waitFor(() => expect(markAll).toBeEnabled());
    // 서버가 바로 0 을 돌려주도록 이후 조회도 갱신
    serve({ unreadCount: 0, items: [item({ read: true })] });
    await userEvent.click(markAll);
    expect(markAllMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: '알림' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    expect(markAll).toBeDisabled();
    expect(within(dialog).queryByText('안 읽음')).not.toBeInTheDocument();
  });
});

describe('NotificationBell 키보드·닫기', () => {
  it('Enter 로 열면 첫 요소에 포커스, Escape 로 닫으면 종 버튼으로 포커스가 돌아온다', async () => {
    serve({ unreadCount: 1, items: [item()] });
    renderShell();
    const bell = await screen.findByRole('button', { name: '알림 1개 안 읽음' });
    bell.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: '알림' });
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('button', { name: '모두 읽음' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bell).toHaveFocus();
    expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  it('바깥(빈 곳) 클릭으로 닫히고 포커스는 종 버튼으로 돌아온다', async () => {
    serve({ unreadCount: 0, items: [] });
    renderShell();
    const { bell } = await openDropdown('알림');
    await userEvent.click(screen.getByText('본문 영역'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bell).toHaveFocus();
  });

  it('드롭다운 안 클릭으로는 닫히지 않는다', async () => {
    serve({ unreadCount: 0, items: [] });
    renderShell();
    const { dialog } = await openDropdown('알림');
    await userEvent.click(await within(dialog).findByText('새 알림이 없습니다.'));
    expect(screen.getByRole('dialog', { name: '알림' })).toBeInTheDocument();
  });

  it('Tab 으로 드롭다운을 벗어나면 닫힌다 (포커스 트랩 없음)', async () => {
    serve({ unreadCount: 1, items: [item()] });
    renderShell();
    const { dialog } = await openDropdown('알림 1개 안 읽음');
    const link = await within(dialog).findByRole('link');
    link.focus();
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '뒤 버튼' })).toHaveFocus();
  });

  it('Shift+Tab 으로 종 버튼에 돌아가면 열린 채 유지된다', async () => {
    serve({ unreadCount: 1, items: [item()] });
    renderShell();
    const { bell, dialog } = await openDropdown('알림 1개 안 읽음');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '모두 읽음' })).toHaveFocus(),
    );
    await userEvent.tab({ shift: true });
    expect(bell).toHaveFocus();
    expect(screen.getByRole('dialog', { name: '알림' })).toBeInTheDocument();
  });

  it('Modal(dialog[open]·aria-modal)이 열려 있으면 Escape 를 처리하지 않는다', async () => {
    serve({ unreadCount: 0, items: [] });
    renderShell();
    await openDropdown('알림');
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: '알림' })).toBeInTheDocument();
    modal.remove();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '알림' })).not.toBeInTheDocument(),
    );
  });
});

describe('단독 동작 (UX PR-C2 — #31 챗 패널 결합 제거)', () => {
  it('챗 컨텍스트(Provider) 없이 열고 닫히고, 연타해도 마지막 의도만 남는다', async () => {
    serve({ unreadCount: 0, items: [] });
    renderShell();
    const bell = screen.getByRole('button', { name: '알림' });
    await userEvent.click(bell);
    expect(screen.getByRole('dialog', { name: '알림' })).toBeInTheDocument();
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(bell);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '알림' })).not.toBeInTheDocument(),
    );
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(bell);
    await userEvent.click(bell);
    await userEvent.click(bell);
    expect(await screen.findByRole('dialog', { name: '알림' })).toBeInTheDocument();
  });

  it('알림 코드에 챗봇 모듈 의존이 없다', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/features/notifications/NotificationBell.tsx', 'utf8');
    expect(source).not.toMatch(/features\/chat|useChatPanel|setOverlayVisible/);
  });
});
