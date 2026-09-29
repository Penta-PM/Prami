import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { hasPermission, ROLE_LABELS } from '@/lib/constants/permissions';
import { ChatProvider } from '@/features/chat/ChatContext';
import { ChatDock } from '@/features/chat/ChatDock';
import { Header } from '@/features/shell/Header';
import { Sidebar } from '@/features/shell/Sidebar';
import { env } from '@/env';
import { getSessionUser } from '@/server/auth/rbac';
import { isTestModeEnabled } from '@/server/auth/providers';

/**
 * 앱 셸: 사이드바 + (헤더 + 본문). 로그인·공유 페이지는 이 그룹 밖에 둔다.
 * proxy 가 비로그인 요청을 먼저 막지만, 셸도 세션(비활성 반영)을 다시 확인한다.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const roleLabel = [ROLE_LABELS[user.role], user.department].filter(Boolean).join(' · ');

  return (
    <ChatProvider>
      <div className="flex h-screen overflow-hidden bg-surface-page">
        <Sidebar showAdminNav={hasPermission(user.role, 'users.manage')} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header user={{ name: user.name, roleLabel }} testMode={isTestModeEnabled(env)} />
          <main className="flex-1 overflow-y-auto p-8">{children}</main>
        </div>
        <ChatDock />
      </div>
    </ChatProvider>
  );
}
