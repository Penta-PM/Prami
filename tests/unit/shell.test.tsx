import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from '@/app/(app)/layout';
import { ChatProvider } from '@/features/chat/ChatContext';
import { Header } from '@/features/shell/Header';
import { Sidebar } from '@/features/shell/Sidebar';

const usePathnameMock = vi.fn<() => string>(() => '/');
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getSessionUserMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  redirect: (url: string) => redirectMock(url),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }));
// #31: 헤더 알림 버튼은 마운트 시 GET /api/notifications 를 부른다 — fetch·서버 액션은 모킹
vi.mock('@/features/notifications/actions', () => ({
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));
const fetchMock = vi.fn(
  async () =>
    ({ ok: true, status: 200, json: async () => ({ unreadCount: 0, items: [] }) }) as Response,
);
vi.mock('@/server/auth/rbac', () => ({ getSessionUser: () => getSessionUserMock() }));

const ADMIN = {
  id: 'u1',
  email: 'admin@pentasecurity.com',
  name: '김도현',
  role: 'ADMIN' as const,
  department: '가격정책팀',
};

beforeEach(() => {
  usePathnameMock.mockReturnValue('/');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Sidebar', () => {
  it('기본(USER)은 일반 메뉴만 렌더한다', () => {
    render(<Sidebar />);
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).queryByText('관리자')).not.toBeInTheDocument();
  });

  it('관리자는 일반·관리자 메뉴를 모두 렌더하고 역할 토글은 없다', () => {
    render(<Sidebar showAdminNav />);
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
    expect(within(nav).getByText('관리자')).toBeInTheDocument();
    expect(screen.queryByText('보기 권한')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '일반 사용자' })).not.toBeInTheDocument();
  });

  it('조달 섹션: 등록 품목 화면에서는 등록 품목만 활성이다 (조달 실적 현황은 exact)', () => {
    usePathnameMock.mockReturnValue('/procurement/items');
    render(<Sidebar showProcurementNav />);
    expect(screen.getByRole('link', { name: '등록 품목' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '조달 실적 현황' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.queryByRole('link', { name: '조달 관리' })).not.toBeInTheDocument();
  });

  it('권한 없음(기본 props)이면 조달 섹션도 없다', () => {
    render(<Sidebar />);
    expect(screen.queryByText('조달', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '조달 실적 현황' })).not.toBeInTheDocument();
  });

  it('현재 경로의 메뉴에 aria-current=page 를 준다', () => {
    usePathnameMock.mockReturnValue('/admin/costs');
    render(<Sidebar showAdminNav />);
    expect(screen.getByRole('link', { name: '원가 관리' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'HOME' })).not.toHaveAttribute('aria-current');
  });

  it('접기 버튼으로 라벨을 숨기고 다시 펼친다', async () => {
    render(<Sidebar showAdminNav />);
    const toggle = screen.getByRole('button', { name: '사이드바 접기/펼치기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('가격 정책 조회')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('가격 정책 조회')).not.toBeInTheDocument();
    expect(screen.queryByText('관리자')).not.toBeInTheDocument();
    // 접힌 상태에서도 링크(아이콘)는 title 로 접근 가능하다
    expect(screen.getByRole('link', { name: '가격 정책 조회' })).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('가격 정책 조회')).toBeInTheDocument();
  });

  it('PRAMI-003 AC-375 ②: 좁은 화면 메뉴 버튼이 오버레이를 열고, 바깥 누름·Esc·메뉴 선택으로 닫는다', async () => {
    render(<Sidebar showAdminNav />);
    const aside = screen.getByRole('complementary', { name: '주 메뉴' });
    const open = screen.getByRole('button', { name: '메뉴 열기' });
    expect(open).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(aside).toHaveAttribute('data-mobile-open', 'false');
    expect(aside.className).toContain('max-md:-translate-x-full');

    await userEvent.click(open);
    expect(aside).toHaveAttribute('data-mobile-open', 'true');
    expect(aside.className).not.toContain('max-md:-translate-x-full');
    const backdrops = screen.getAllByRole('button', { name: '메뉴 닫기' });
    await userEvent.click(backdrops.at(-1)!);
    expect(aside).toHaveAttribute('data-mobile-open', 'false');

    // 메뉴 버튼에 포커스가 있어도 Esc 로 닫히고 포커스는 메뉴 버튼으로 돌아온다
    const menuButton = screen.getByRole('button', { name: '메뉴 열기' });
    await userEvent.click(menuButton);
    await waitFor(() => expect(within(aside).getAllByRole('link')[0]).toHaveFocus());
    menuButton.focus();
    await userEvent.keyboard('{Escape}');
    expect(aside).toHaveAttribute('data-mobile-open', 'false');
    expect(menuButton).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: '메뉴 열기' }));
    await userEvent.click(within(aside).getByRole('link', { name: '원가 관리' }));
    expect(aside).toHaveAttribute('data-mobile-open', 'false');
  });
});

describe('Header', () => {
  it('검색·챗봇·알림 컨트롤과 게스트 상태를 렌더한다', async () => {
    // 헤더의 챗봇 런처는 ChatProvider 컨텍스트를 쓴다 (PR-10)
    render(
      <ChatProvider>
        <Header />
      </ChatProvider>,
    );
    expect(screen.getByRole('searchbox', { name: '통합 검색' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '챗봇' })).toBeInTheDocument();
    // #31: 장식용 "공지사항" 종 → 알림 버튼 (안 읽은 알림 0 → 이름 "알림", 배지 없음)
    const bell = screen.getByRole('button', { name: '알림' });
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog');
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '공지사항' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument();
    expect(screen.getByText('로그인 필요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('사용자 정보가 있으면 이름·역할·이니셜을 표시한다', () => {
    render(
      <ChatProvider>
        <Header user={{ name: '김도현', roleLabel: '관리자 · 가격정책팀' }} />
      </ChatProvider>,
    );
    expect(screen.getByText('김도현')).toBeInTheDocument();
    expect(screen.getByText('관리자 · 가격정책팀')).toBeInTheDocument();
    expect(screen.getByText('김')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    // PRAMI-002: 본인 설정 진입점
    expect(screen.getByRole('link', { name: '사용자 설정' })).toHaveAttribute('href', '/settings');
  });
});

describe('AppLayout', () => {
  it('비로그인이면 /login 으로 보낸다', async () => {
    getSessionUserMock.mockResolvedValue(null);
    await expect(AppLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('USER 에게는 관리자 메뉴를 숨긴다', async () => {
    getSessionUserMock.mockResolvedValue({ ...ADMIN, role: 'USER', department: null });
    render(await AppLayout({ children: <p>본문</p> }));
    expect(screen.queryByText('관리자', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.getByText('사용자')).toBeInTheDocument();
  });

  it('USER 는 조달 섹션(3개)을 보고 조달 관리는 보지 않는다 (procurement.read·write)', async () => {
    getSessionUserMock.mockResolvedValue({ ...ADMIN, role: 'USER', department: null });
    render(await AppLayout({ children: <p>본문</p> }));
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(within(nav).getByText('조달', { selector: 'div' })).toBeInTheDocument();
    for (const [name, href] of [
      ['조달 실적 현황', '/procurement'],
      ['등록 품목', '/procurement/items'],
      ['입찰 공고', '/procurement/bids'],
    ]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(within(nav).queryByRole('link', { name: '조달 관리' })).not.toBeInTheDocument();
  });

  it('ADMIN 은 조달 섹션과 관리자 섹션의 조달 관리를 모두 본다', async () => {
    getSessionUserMock.mockResolvedValue(ADMIN);
    render(await AppLayout({ children: <p>본문</p> }));
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(within(nav).getByRole('link', { name: '조달 실적 현황' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: '조달 관리' })).toHaveAttribute(
      'href',
      '/admin/procurement',
    );
    expect(within(nav).getAllByRole('link')).toHaveLength(3 + 3 + 8);
  });

  it('사이드바·헤더·본문을 조합하고 세션 사용자를 표시한다', async () => {
    getSessionUserMock.mockResolvedValue(ADMIN);
    render(await AppLayout({ children: <p>본문</p> }));
    expect(screen.getByText('관리자 · 가격정책팀')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '주 메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('본문')).toBeInTheDocument();
  });
});
