import type { ReactNode } from 'react';

import { requireAdminArea } from '@/server/auth/rbac';

/** 관리자 영역 (2차 방어). proxy 를 우회한 요청도 여기서 역할을 다시 확인한다 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminArea();
  return children;
}
