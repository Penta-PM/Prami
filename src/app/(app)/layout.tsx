import type { ReactNode } from 'react';

import { Header } from '@/features/shell/Header';
import { Sidebar } from '@/features/shell/Sidebar';

/** 앱 셸: 사이드바 + (헤더 + 본문). 로그인·공유 페이지는 이 그룹 밖에 둔다 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
