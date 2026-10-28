import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from '@/app/(app)/layout';
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
  it('기본(권한 없음)은 HOME 만 렌더한다 — 가격 정책·조달·관리자 섹션 없음', () => {
    render(<Sidebar />);
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['HOME']);
    expect(within(nav).queryByText('가격 정책', { selector: 'div' })).not.toBeInTheDocument();
    expect(within(nav).queryByText('관리자')).not.toBeInTheDocument();
  });

  it('UX PR-U1: "가격 정책" 섹션 아래 가격 정책 조회·계산기 — 섹션 순서 가격 정책 → 조달 → 관리자, URL 그대로', () => {
    render(<Sidebar showPricingNav showCalculatorNav showProcurementNav showAdminNav />);
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    const headers = Array.from(nav.querySelectorAll('nav > div')).map((el) => el.textContent);
    expect(headers).toEqual(['가격 정책', '조달', '관리자']);
    const links = within(nav).getAllByRole('link');
    expect(links.slice(0, 3).map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['HOME', '/'],
      ['가격 정책 조회', '/pricing'],
      ['계산기', '/calculator'],
    ]);
    // 가격 정책 섹션 머리는 HOME 뒤, 가격 정책 조회 앞
    const pricingHeader = within(nav).getByText('가격 정책', { selector: 'div' });
    expect(
      links[0]!.compareDocumentPosition(pricingHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      pricingHeader.compareDocumentPosition(links[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('UX PR-U1: 가격 정책 섹션은 항목별 권한으로 보이고, 둘 다 없으면 섹션 머리도 없다', () => {
    const { unmount } = render(<Sidebar showCalculatorNav />);
    expect(screen.getByText('가격 정책', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '계산기' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '가격 정책 조회' })).not.toBeInTheDocument();
    unmount();
    render(<Sidebar showProcurementNav />);
    expect(screen.queryByText('가격 정책', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('UX PR-U1: 가격 정책 조회는 exact — /pricing 에서만 활성, /pricing/chat 에서는 활성 아님', () => {
    usePathnameMock.mockReturnValue('/pricing');
    const { unmount } = render(<Sidebar showPricingNav showCalculatorNav />);
    expect(screen.getByRole('link', { name: '가격 정책 조회' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    unmount();
    usePathnameMock.mockReturnValue('/pricing/chat');
    render(<Sidebar showPricingNav showCalculatorNav />);
    expect(screen.getByRole('link', { name: '가격 정책 조회' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: '계산기' })).not.toHaveAttribute('aria-current');
  });

  it('UX PR-C2: 챗봇 메뉴 — 가격 정책 섹션 끝 "가격 정책 챗봇", 조달 섹션 끝 "조달 챗봇"(chat.use 없으면 둘 다 없음)', () => {
    const { unmount } = render(
      <Sidebar showPricingNav showCalculatorNav showChatNav showProcurementNav />,
    );
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/',
      '/pricing',
      '/calculator',
      '/pricing/chat',
      '/procurement',
      '/procurement/items',
      '/procurement/bids',
      '/procurement/chat',
    ]);
    // Penta message 아이콘
    expect(
      screen.getByRole('link', { name: '가격 정책 챗봇' }).querySelector('[data-icon="message"]'),
    ).not.toBeNull();
    unmount();
    render(<Sidebar showPricingNav showCalculatorNav showProcurementNav />);
    expect(screen.queryByRole('link', { name: '가격 정책 챗봇' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '조달 챗봇' })).not.toBeInTheDocument();
  });

  it('UX PR-C2: 조달 챗봇은 procurement.read 없으면(조달 섹션 없음) chat.use 가 있어도 보이지 않는다', () => {
    render(<Sidebar showChatNav />);
    expect(screen.getByRole('link', { name: '가격 정책 챗봇' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '조달 챗봇' })).not.toBeInTheDocument();
    expect(screen.queryByText('조달', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('UX PR-C2: /pricing/chat·/procurement/chat 에서는 그 챗봇 메뉴만 활성', () => {
    usePathnameMock.mockReturnValue('/pricing/chat');
    const { unmount } = render(
      <Sidebar showPricingNav showCalculatorNav showChatNav showProcurementNav />,
    );
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent),
    ).toEqual(['가격 정책 챗봇']);
    unmount();
    usePathnameMock.mockReturnValue('/procurement/chat');
    render(<Sidebar showPricingNav showCalculatorNav showChatNav showProcurementNav />);
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent),
    ).toEqual(['조달 챗봇']);
  });

  it('관리자는 일반·관리자 메뉴를 모두 렌더하고 역할 토글은 없다', () => {
    render(<Sidebar showPricingNav showCalculatorNav showAdminNav />);
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

  it('Penta 활성 메뉴: P50 바탕 + P700 글자·아이콘 + 왼쪽 3px P500 막대, 모든 메뉴에 포커스 고리', () => {
    usePathnameMock.mockReturnValue('/admin/costs');
    render(<Sidebar showAdminNav />);
    const active = screen.getByRole('link', { name: '원가 관리' });
    expect(active).toHaveClass(
      'bg-primary-50',
      'text-primary-700',
      'font-semibold',
      'before:w-[3px]',
      'before:bg-primary-500',
      'before:left-0',
    );
    expect(active.querySelector('svg')).toHaveClass('text-primary-700');
    expect(active.className).not.toMatch(/lime/);
    const idle = screen.getByRole('link', { name: 'HOME' });
    expect(idle).not.toHaveClass('bg-primary-50');
    expect(idle.className).not.toMatch(/before:bg-/);
    for (const link of [active, idle])
      expect(link).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-focus-ring');
  });

  it('접기 버튼으로 라벨을 숨기고 다시 펼친다', async () => {
    render(<Sidebar showPricingNav showCalculatorNav showAdminNav />);
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
  it('검색·알림 컨트롤과 게스트 상태를 렌더한다 — 챗봇 버튼은 없다 (UX PR-C2, 컨텍스트 없이 렌더)', async () => {
    render(<Header />);
    expect(screen.getByRole('searchbox', { name: '통합 검색' })).toBeInTheDocument();
    // 헤더 챗봇 진입점 제거 — 사이드바 "가격 정책 챗봇"·"조달 챗봇" 메뉴로 옮겼다
    expect(screen.queryByRole('button', { name: /챗봇/ })).not.toBeInTheDocument();
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
    render(<Header user={{ name: '김도현', roleLabel: '관리자 · 가격정책팀' }} />);
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
    // UX PR-U1: USER 도 가격 정책 섹션(pricing.read·calculator.use)을 본다, PR-C2: 챗봇 메뉴(chat.use) 두 개
    expect(within(nav).getByText('가격 정책', { selector: 'div' })).toBeInTheDocument();
    for (const [name, href] of [
      ['가격 정책 조회', '/pricing'],
      ['계산기', '/calculator'],
      ['가격 정책 챗봇', '/pricing/chat'],
      ['조달 실적 현황', '/procurement'],
      ['등록 품목', '/procurement/items'],
      ['입찰 공고', '/procurement/bids'],
      ['조달 챗봇', '/procurement/chat'],
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
    // HOME 1 + 가격 정책 3(챗봇 포함) + 조달 4(챗봇 포함) + 관리자 8
    expect(within(nav).getAllByRole('link')).toHaveLength(1 + 3 + 4 + 8);
  });

  it('사이드바·헤더·본문을 조합하고 세션 사용자를 표시한다', async () => {
    getSessionUserMock.mockResolvedValue(ADMIN);
    render(await AppLayout({ children: <p>본문</p> }));
    expect(screen.getByText('관리자 · 가격정책팀')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '주 메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('본문')).toBeInTheDocument();
  });

  it('UX PR-C2: 셸에 헤더 챗봇 버튼·도킹 패널이 없고 알림 버튼은 그대로다', async () => {
    getSessionUserMock.mockResolvedValue(ADMIN);
    render(await AppLayout({ children: <p>본문</p> }));
    expect(screen.queryByRole('button', { name: /챗봇/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /챗봇/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument();
    // 셸에 남은 complementary 는 사이드바뿐
    expect(screen.getAllByRole('complementary').map((el) => el.getAttribute('aria-label'))).toEqual(
      ['주 메뉴'],
    );
  });
});
