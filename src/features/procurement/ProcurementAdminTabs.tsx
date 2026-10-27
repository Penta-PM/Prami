'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Segmented } from '@/components/ui';
import { PROCUREMENT_ADMIN_TABS, type ProcurementAdminTab } from '@/lib/procurement/admin-tabs';

import { ProcurementPlaceholder } from './ProcurementPlaceholder';

const TAB_DESCRIPTIONS: Record<ProcurementAdminTab, string> = {
  deliveries: '납품요구 실적 편집·제외·복원은 단계 3에서 제공합니다.',
  items: '신규 품목 검토·등록 품목 편집·휴지통은 단계 3에서 제공합니다.',
  keywords: '입찰 공고 키워드 편집은 단계 3에서 제공합니다.',
};

/**
 * 조달 관리 탭 (D-2: 실적 관리·품목 관리·키워드 관리). UI-1 은 셸만 — 각 탭은 "단계 3에서 제공" 자리 표시이고 쓰기 동작이 없다.
 * 탭을 바꾸면 `?tab=` 을 URL 에 반영한다(router.replace — 히스토리 누적 없음, 계산기 탭과 같은 방식). 같은 경로로 조회 상태가
 * 저장·복원된다(page-state-memory B-1 — 기본 탭은 정규화에서 생략). 항상 tab 을 붙여 빈 쿼리 이동(저장 상태 복원 redirect)을 만들지 않는다.
 */
export function ProcurementAdminTabs({ initialTab }: { initialTab: ProcurementAdminTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<ProcurementAdminTab>(initialTab);
  const current = PROCUREMENT_ADMIN_TABS.find((option) => option.value === tab);

  const changeTab = (next: ProcurementAdminTab) => {
    setTab(next);
    const query = new URLSearchParams({ tab: next }).toString();
    router.replace(`${pathname ?? '/admin/procurement'}?${query}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-full overflow-x-auto">
        <Segmented
          aria-label="조달 관리 메뉴"
          options={PROCUREMENT_ADMIN_TABS}
          value={tab}
          onChange={changeTab}
          className="w-fit"
        />
      </div>
      <section aria-label={current?.label}>
        <ProcurementPlaceholder
          title={`${current?.label ?? ''} — 단계 3에서 제공`}
          description={TAB_DESCRIPTIONS[tab]}
        />
      </section>
    </div>
  );
}
