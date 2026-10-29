import type { Metadata } from 'next';

import { getDb } from '@/db';
import { FamilyTabs } from '@/features/parts/FamilyTabs';
import { PartsManager } from '@/features/parts/PartsManager';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { requirePagePermission } from '@/server/auth/rbac';
import { listReusableBatches } from '@/server/imports/queries';
import { listPartsCatalog, listProductFamilies } from '@/server/parts/catalog';
import { listPartMappings } from '@/server/parts/queries';
import { restoreViewState } from '@/server/page-state/restore-page';

export const metadata: Metadata = { title: '파츠 관리' };

type AdminPartsPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PARTS_PATH = '/admin/parts';

function pickFamily(families: readonly string[], raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && families.includes(value)) return value;
  return families.includes('WAPPLES') ? 'WAPPLES' : (families[0] ?? '');
}

/** 파츠 관리 (§4.5.6, parts.write = ADMIN). 제품군 탭은 `?family=` */
export default async function AdminPartsPage({ searchParams }: AdminPartsPageProps) {
  const actor = await requirePagePermission('parts.write', PARTS_PATH);
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태(제품군 탭·표 필터·정렬)로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('admin-parts', params, actor);
  const db = await getDb();
  const families = await listProductFamilies(db);
  const family = pickFamily(families, params.family);
  const [catalog, mappings, batches] = await Promise.all([
    family ? listPartsCatalog(db, family) : Promise.resolve({ models: [], parts: [] }),
    listPartMappings(db, family || undefined),
    listReusableBatches(db, 'part_mapping'),
  ]);

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-[18px]">
      <div>
        <h1 id="page-title" className="m-0 mb-1.5 [font:var(--text-page-title)]">
          파츠 관리
        </h1>
        <p className="m-0 text-[12px] text-text-tertiary">
          모델별로 장착 가능한 파츠를 등록합니다. 예: Wapples-2700 (H2700) → N_51080. 파츠는 품목
          마스터의 품목 종류 또는 품명 규칙(N_…)으로 구분합니다.
        </p>
      </div>
      {families.length > 0 ? (
        <FamilyTabs families={families} active={family} basePath={PARTS_PATH} />
      ) : (
        <p className="m-0 text-[14px] text-text-tertiary">
          판매단가가 적용되면 모델·파츠 목록이 나타납니다.
        </p>
      )}
      <PartsManager
        models={catalog.models}
        parts={catalog.parts}
        mappings={mappings}
        batchOptions={batches}
        userId={actor.id}
      />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
