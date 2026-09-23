import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from '@/app/(app)/layout';
import { Header } from '@/features/shell/Header';
import { Sidebar } from '@/features/shell/Sidebar';

const usePathnameMock = vi.fn<() => string>(() => '/');

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue('/');
});

describe('Sidebar', () => {
  it('일반·관리자 메뉴를 모두 렌더하고 역할 토글은 없다', () => {
    render(<Sidebar />);
    const nav = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
    expect(within(nav).getByText('관리자')).toBeInTheDocument();
    expect(screen.queryByText('보기 권한')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '일반 사용자' })).not.toBeInTheDocument();
  });

  it('현재 경로의 메뉴에 aria-current=page 를 준다', () => {
    usePathnameMock.mockReturnValue('/admin/costs');
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: '원가 관리' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'HOME' })).not.toHaveAttribute('aria-current');
  });

  it('접기 버튼으로 라벨을 숨기고 다시 펼친다', async () => {
    render(<Sidebar />);
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
});

describe('Header', () => {
  it('검색·챗봇·공지 컨트롤과 게스트 상태를 렌더한다', () => {
    render(<Header />);
    expect(screen.getByRole('searchbox', { name: '통합 검색' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '챗봇' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '공지사항' })).toBeInTheDocument();
    expect(screen.getByText('로그인 필요')).toBeInTheDocument();
  });

  it('사용자 정보가 있으면 이름·역할·이니셜을 표시한다', () => {
    render(<Header user={{ name: '김도현', roleLabel: '관리자 · 가격정책팀' }} />);
    expect(screen.getByText('김도현')).toBeInTheDocument();
    expect(screen.getByText('관리자 · 가격정책팀')).toBeInTheDocument();
    expect(screen.getByText('김')).toBeInTheDocument();
  });
});

describe('AppLayout', () => {
  it('사이드바·헤더·본문을 조합한다', () => {
    render(
      <AppLayout>
        <p>본문</p>
      </AppLayout>,
    );
    expect(screen.getByRole('complementary', { name: '주 메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('본문')).toBeInTheDocument();
  });
});
