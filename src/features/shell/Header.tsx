import Link from 'next/link';

import { Icon } from '@/components/icons/Icon';
import { Input } from '@/components/ui/input';
import { signOutAction } from '@/features/auth/actions';
import { TestModeBanner } from '@/features/auth/TestModeBanner';
import { ChatLauncher } from '@/features/chat/ChatDock';
import { NotificationBell } from '@/features/notifications/NotificationBell';

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

/** 앱 셸 헤더: 통합 검색, 챗봇/알림 버튼, 사용자 표시·로그아웃 */
export function Header({ user, testMode = false }: HeaderProps) {
  const initial = user?.name.trim().charAt(0) || '?';

  return (
    <header className="sticky top-0 z-[5] flex h-[72px] shrink-0 items-center gap-5 border-b border-border-subtle bg-surface-page px-8 max-md:gap-2 max-md:pr-3 max-md:pl-14">
      <form role="search" action="/search" method="get" className="max-w-[480px] min-w-0 flex-1">
        <Input
          type="search"
          name="q"
          aria-label="통합 검색"
          placeholder="제품, 모델, 가격정책, 공지사항 검색"
          leading={<Icon name="search" />}
        />
      </form>
      <div className="flex-1 max-md:hidden" />
      {testMode ? <TestModeBanner variant="inline" /> : null}
      <ChatLauncher />
      <NotificationBell />
      <div className="flex items-center gap-2.5 border-l border-border-subtle pl-3.5 max-md:gap-1 max-md:pl-2">
        <div
          aria-hidden="true"
          className="flex size-[34px] items-center justify-center rounded-circle bg-ink-900 text-[13px] font-semibold text-white"
        >
          {initial}
        </div>
        <div className="leading-[1.3] max-md:hidden">
          <div className="text-[13px] font-semibold">{user?.name ?? '로그인 필요'}</div>
          <div className="text-[11px] font-medium text-text-tertiary">{user?.roleLabel ?? ''}</div>
        </div>
        {user ? (
          <Link
            href="/settings"
            className="ml-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-text-tertiary hover:bg-gray-100 hover:text-ink-900 max-md:hidden"
          >
            사용자 설정
          </Link>
        ) : null}
        {user ? (
          <form action={signOutAction}>
            <button
              type="submit"
              className="ml-1 rounded-lg border-0 bg-transparent px-2 py-1.5 text-[12px] font-semibold text-text-tertiary hover:bg-gray-100 hover:text-ink-900"
            >
              로그아웃
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
