import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { ROLE_LABELS } from '@/lib/constants/permissions';
import { APP_MAIN_ID } from '@/lib/page-state/keys';
import { Header } from '@/features/shell/Header';
import { navVisibility } from '@/features/shell/nav';
import { Sidebar } from '@/features/shell/Sidebar';
import { env } from '@/env';
import { getSessionUser } from '@/server/auth/rbac';
import { isTestModeEnabled } from '@/server/auth/providers';

/**
 * 앱 셸: 사이드바 + (헤더 + 본문). 로그인·공유 페이지는 이 그룹 밖에 둔다.
 * proxy 가 비로그인 요청을 먼저 막지만, 셸도 세션(비활성 반영)을 다시 확인한다.
 * 챗봇은 셸에 붙지 않는다 — 헤더 버튼·도킹 패널을 걷어 내고 각 섹션 화면(/pricing/chat·/procurement/chat)으로 옮겼다 (UX PR-C2).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const roleLabel = [ROLE_LABELS[user.role], user.department].filter(Boolean).join(' · ');

  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <Sidebar {...navVisibility(user.role)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={{ name: user.name, roleLabel }} testMode={isTestModeEnabled(env)} />
        <main id={APP_MAIN_ID} className="flex-1 overflow-y-auto p-8 max-md:p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
