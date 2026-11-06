import Link from 'next/link';

import { signOutAction } from '@/features/auth/actions';
import { TestModeBanner } from '@/features/auth/TestModeBanner';
import { NotificationBell } from '@/features/notifications/NotificationBell';

import { AccountMenu } from './AccountMenu';
import { HeaderSearch } from './HeaderSearch';

export type HeaderUser = {
  name: string;
  /** 예: "관리자 · 가격정책팀" */
  roleLabel: string;
};

export type HeaderProps = {
  /** 로그인 사용자 (세션). 없으면 게스트 표시 */
  user?: HeaderUser;
  /** AUTH_TEST_MODE 가 켜져 있으면 TEST MODE 배지 (§4.8 r5 ④) */
  testMode?: boolean;
};

/**
 * 앱 셸 헤더: 통합 검색, 알림 버튼, 사용자 표시·로그아웃. 챗봇 진입점은 사이드바 메뉴(UX PR-C2 — 헤더 버튼 제거).
 * `max-md`(모바일 UI 스펙 §3 헤더): 높이 56px(+위쪽 safe-area), 왼쪽 ☰(Sidebar, fixed 44px) 자리를 비우고, 검색은 아이콘 → 펼침,
 * 오른쪽은 알림·아바타(누르면 계정 시트 — 이름/역할·사용자 설정·로그아웃). 768px 이상은 기존 72px 헤더 그대로.
 */
export function Header({ user, testMode = false }: HeaderProps) {
  const initial = user?.name.trim().charAt(0) || '?';

  return (
    <header className="sticky top-0 z-[5] flex h-[72px] shrink-0 items-center gap-5 border-b border-border-subtle bg-surface-page px-8 max-md:h-(--app-header-height-mobile) max-md:gap-2 max-md:pt-(--safe-top) max-md:pr-3 max-md:pl-16">
      <HeaderSearch />
      <div className="flex-1" />
      {testMode ? <TestModeBanner variant="inline" /> : null}
      <NotificationBell />
      {user ? <AccountMenu user={user} initial={initial} /> : null}
      <div className="flex items-center gap-2.5 border-l border-border-subtle pl-3.5 max-md:hidden">
        <div
          aria-hidden="true"
          className="flex size-[34px] items-center justify-center rounded-circle bg-surface-inverse text-[14px] font-semibold text-text-inverse"
        >
          {initial}
        </div>
        <div className="leading-[1.3]">
          <div className="text-[14px] font-semibold text-text-primary">
            {user?.name ?? '로그인 필요'}
          </div>
          <div className="text-[11px] font-medium text-text-tertiary">{user?.roleLabel ?? ''}</div>
        </div>
        {user ? (
          <Link
            href="/settings"
            className="ml-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-text-tertiary no-underline hover:bg-neutral-100 hover:text-text-primary hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            사용자 설정
          </Link>
        ) : null}
        {user ? (
          <form action={signOutAction}>
            <button
              type="submit"
              className="ml-1 rounded-lg border-0 bg-transparent px-2 py-1.5 text-[12px] font-semibold text-text-tertiary hover:bg-neutral-100 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              로그아웃
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
