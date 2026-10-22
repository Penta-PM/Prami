import type { Metadata } from 'next';
import Link from 'next/link';

import { ErpPathHint } from '@/components/ui';
import { getDb } from '@/db';
import { CostLinkImport } from '@/features/costs/CostLinkImport';
import { CostLinkManager } from '@/features/costs/CostLinkManager';
import {
  ERP_HINT_COST_LINK,
  ERP_HINT_ITEM_COST_LINK_ON_LINKS_PAGE,
} from '@/lib/constants/erp-guide';
import { hasPermission } from '@/lib/constants/permissions';
import { getSessionUser } from '@/server/auth/rbac';
import { requireCostPageAccess } from '@/server/cost/access';
import { listCostLinkView } from '@/server/cost/item-links';

export const metadata: Metadata = { title: '원가 매핑' };

/**
 * 원가 매핑 관리 (스펙 cost-ratio-price-change §2.1). 조회는 cost.read(2차 방어), 확정·해제·매칭 파일 업로드는
 * cost.write — 없으면 읽기 전용으로 그린다(Action 도 cost.write 로 다시 막는다). 원가 금액은 이 화면에 없다.
 */
export default async function AdminCostLinksPage() {
  const access = await requireCostPageAccess('/admin/costs/links');
  const [user, view] = await Promise.all([
    getSessionUser(),
    getDb().then((db) => listCostLinkView(access, db)),
  ]);
  const canWrite = hasPermission(user?.role, 'cost.write');

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <Link href="/admin/costs" className="text-[12px] font-semibold text-text-tertiary">
        ← 원가 관리로
      </Link>
      {/* 항목 4(품목-원가 매칭) ERP 경로 — cost.write 면 매칭 파일 업로드 영역 옆(§6.2-1), 아니면 제목 옆 토글팁만 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          원가 매핑
        </h1>
        {ERP_HINT_ITEM_COST_LINK_ON_LINKS_PAGE && !canWrite ? (
          <ErpPathHint
            label="원가 매핑"
            item={ERP_HINT_COST_LINK.item}
            path={ERP_HINT_COST_LINK.path}
          />
        ) : null}
      </div>
      <p className="m-0 text-[12px] text-text-tertiary">
        가격 품목(품목코드)마다 원가 자재(자재번호) 하나를 연결합니다. 모델명으로 고른 제안은
        저장되지 않으며, 확정한 행만 저장됩니다.
      </p>
      {/* 품목-원가 매칭 파일 업로드 (erp-upload-guide §6.2) — cost.write 만. 파일은 브라우저에서만 읽는다 */}
      {canWrite ? <CostLinkImport /> : null}
      {/* 페이지 접근은 세션 사용자만 통과하므로 userId 는 항상 있다 */}
      <CostLinkManager view={view} canWrite={canWrite} userId={access.userId ?? ''} />
    </section>
  );
}
