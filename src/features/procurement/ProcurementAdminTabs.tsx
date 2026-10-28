'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useOptimistic, useTransition, type ReactNode } from 'react';

import { Segmented } from '@/components/ui';
import { PROCUREMENT_ADMIN_TABS, type ProcurementAdminTab } from '@/lib/procurement/admin-tabs';

/**
 * 조달 관리 탭 셸 (D-2: 실적 관리·품목 관리·키워드 관리·메일 보고 — Plan msg_9f2035d66cd8 공용 패턴).
 * 탭 상태는 URL(`?tab=`)이고 탭 내용은 페이지 RSC 가 searchParams 로 서버에서 읽어 `children` 으로 넘긴다.
 * 탭을 바꾸면 `router.push('?tab=<next>')` — 다른 탭의 조건 파라미터는 버린다(탭 사이로 새지 않게). 항상 tab 을 붙여
 * 빈 쿼리 이동(저장 상태 복원 redirect)을 만들지 않는다. 이동하는 동안 선택 표시는 낙관적으로 먼저 바꾼다.
 */
export function ProcurementAdminTabs({
  tab,
  children,
}: {
  tab: ProcurementAdminTab;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [shownTab, setShownTab] = useOptimistic(tab);
  const current = PROCUREMENT_ADMIN_TABS.find((option) => option.value === tab);

  const changeTab = (next: ProcurementAdminTab) => {
    if (next === shownTab) return;
    startTransition(() => {
      setShownTab(next);
      const query = new URLSearchParams({ tab: next }).toString();
      router.push(`${pathname ?? '/admin/procurement'}?${query}`, { scroll: false });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-full overflow-x-auto">
        <Segmented
          aria-label="조달 관리 메뉴"
          options={PROCUREMENT_ADMIN_TABS}
          value={shownTab}
          onChange={changeTab}
          className="w-fit"
        />
      </div>
      <section aria-label={current?.label} aria-busy={isPending || undefined}>
        {children}
      </section>
    </div>
  );
}
