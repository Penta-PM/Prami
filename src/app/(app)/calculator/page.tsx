import type { Metadata } from 'next';

import { getDb } from '@/db';
import { CalculatorTabs } from '@/features/calculator/CalculatorTabs';
import type { FamilyPreload } from '@/features/calculator/types';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { hasPermission } from '@/lib/constants/permissions';
import { requirePagePermission } from '@/server/auth/rbac';
import { listGroupChips } from '@/server/groups/queries';
import { listProductFamilies } from '@/server/parts/catalog';
import {
  listGroupHardware,
  listQuoteCategories,
  listQuotePriceTypes,
} from '@/server/quotes/catalog';
import { listMyQuotes } from '@/server/quotes/queries';
import { restoreViewState } from '@/server/page-state/restore-page';

export const metadata: Metadata = { title: '계산기' };

type CalculatorPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 계산기 (§4.5.7, calculator.use = USER 이상). 제품군별 STEP1(단가유형 DISTINCT)·STEP2(분류)·그룹 칩·하드웨어 후보를
 * 미리 내려주고, 품목/파츠/결합형은 선택에 따라 Server Action 으로 가져온다. 순매출 원가 잠금은 역할로 결정한다.
 */
export default async function CalculatorPage({ searchParams }: CalculatorPageProps) {
  const user = await requirePagePermission('calculator.use', '/calculator');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 탭으로 redirect (page-state-memory §2.2-4·7)
  const viewState = await restoreViewState('calculator', params, user);
  const db = await getDb();
  const families = await listProductFamilies(db);
  const preload: FamilyPreload[] = await Promise.all(
    families.map(async (family) => {
      const [priceTypes, categories, groups, hardware] = await Promise.all([
        listQuotePriceTypes(db, family),
        listQuoteCategories(db, family),
        listGroupChips(db, family),
        listGroupHardware(db, family),
      ]);
      return { family, priceTypes, categories, groups, hardware };
    }),
  );
  const savedQuotes = await listMyQuotes(db, user);
  const tab = params.tab === 'margin' ? 'margin' : 'quote';
  // 챗봇 "견적 시작" 링크(§4.5.9): ?family=&item= — 목록에 있는 제품군·품번 형식만 받는다
  const family = typeof params.family === 'string' ? params.family : undefined;
  const item = typeof params.item === 'string' ? params.item : undefined;
  const initial = {
    family: family && families.includes(family) ? family : undefined,
    itemCode: item && /^[A-Za-z0-9_-]{1,50}$/.test(item) ? item : undefined,
  };

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-[18px]">
      <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
        계산기
      </h1>
      <CalculatorTabs
        userId={user.id}
        preload={preload}
        savedQuotes={savedQuotes}
        canSeeCost={hasPermission(user.role, 'cost.read')}
        initialTab={tab}
        initial={initial}
      />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
