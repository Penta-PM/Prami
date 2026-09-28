import type { Metadata } from 'next';

import { getDb } from '@/db';
import { GroupsManager } from '@/features/groups/GroupsManager';
import { FamilyTabs } from '@/features/parts/FamilyTabs';
import { requirePagePermission } from '@/server/auth/rbac';
import { listGroupCandidates, listSolutionGroups } from '@/server/groups/queries';
import { listProductFamilies } from '@/server/parts/catalog';

export const metadata: Metadata = { title: '솔루션 그룹 관리' };

type AdminGroupsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const GROUPS_PATH = '/admin/groups';

function pickFamily(families: readonly string[], raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && families.includes(value)) return value;
  return families.includes('WAPPLES') ? 'WAPPLES' : (families[0] ?? '');
}

/** 솔루션 그룹 관리 (§4.5.6, groups.write = ADMIN). 제품군 탭은 `?family=` */
export default async function AdminGroupsPage({ searchParams }: AdminGroupsPageProps) {
  await requirePagePermission('groups.write', GROUPS_PATH);
  const db = await getDb();
  const families = await listProductFamilies(db);
  const family = pickFamily(families, (await searchParams).family);
  const [groups, candidates, all] = await Promise.all([
    family ? listSolutionGroups(db, family) : Promise.resolve([]),
    family ? listGroupCandidates(db, family) : Promise.resolve([]),
    listSolutionGroups(db),
  ]);
  const counts = Object.fromEntries(
    families.map((entry) => [entry, all.filter((group) => group.productFamily === entry).length]),
  );

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-[18px]">
      <div>
        <h1 id="page-title" className="m-0 mb-1.5 [font:var(--text-page-title)]">
          솔루션 그룹 관리
        </h1>
        <p className="m-0 text-[12px] text-text-tertiary">
          여러 상세 제품을 하나의 솔루션으로 묶어 계산기에서 한 번에 구성할 수 있도록 관리합니다.
          항목 가격은 저장하지 않고 견적 시점의 최신 정상판매가를 보여 줍니다.
        </p>
      </div>
      {families.length > 0 ? (
        <FamilyTabs families={families} active={family} basePath={GROUPS_PATH} counts={counts} />
      ) : null}
      <GroupsManager family={family} groups={groups} candidates={candidates} />
    </section>
  );
}
