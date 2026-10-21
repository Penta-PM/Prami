import 'server-only';

import { getDb } from '@/db';
import { hasPermission } from '@/lib/constants/permissions';
import { getSessionUser } from '@/server/auth/rbac';
import { optionalCostReadAccess } from '@/server/cost/access';
import { getItemLinkCells } from '@/server/cost/item-links';
import type { ItemLinkCell } from '@/server/cost/item-link-types';
import { getCostRatios, type CostRatio } from '@/server/cost/price-ratio';
import { logger } from '@/server/log';

export type { CostRatio, CostRatioReason } from '@/server/cost/price-ratio';
export type { ItemLinkCell } from '@/server/cost/item-link-types';

export type PolicyCostColumns = {
  ratios: Record<number, CostRatio>;
  /** 품목코드 → 원가 매핑 칸 (policy-cost-link-column §2.2-1). 현재 페이지 품목만 */
  links: Record<string, ItemLinkCell>;
  /** cost.write — 매핑 칸이 수정 모달 버튼이 된다(없으면 텍스트만) */
  canEditLinks: boolean;
  /** 계산 실패(예: 원가 매핑 테이블 미적용) — 두 열 모두 칸은 '—', 화면 위에 관리자용 안내 */
  failed: boolean;
};

/**
 * 가격정책 관리 표의 원가 열(원가 비중 cost-ratio-price-change §2.2·§2.3 + 원가 매핑 policy-cost-link-column §2.2-2).
 * 원가 모듈(server/cost) 밖 화면(features/pricing)이 쓰는 유일한 입구 — Server Action 이 아니라 서버 컴포넌트 전용 함수라
 * 클라이언트가 호출할 엔드포인트가 생기지 않는다.
 * - cost.read 가 없으면 null → 호출 측은 열 정의·prop 자체를 만들지 않는다(RSC payload 에 costRatio·costLink 키 0).
 *   두 열을 **한 번의** optionalCostReadAccess 로 함께 판정·로드한다.
 * - 원가 열은 보조 정보라 계산이 실패해도 가격정책 화면 전체를 죽이지 않는다(migration-apply-lan §2-3): 서버 로그 +
 *   빈 결과 + failed. 권한 확인 실패·가격 행 조회 실패는 여기서 삼키지 않는다(본 기능 — 기존 오류 화면).
 */
export async function loadPolicyCostColumns(
  rows: readonly { id: number; itemCode: string }[],
): Promise<PolicyCostColumns | null> {
  const access = await optionalCostReadAccess();
  if (!access) return null;
  const canEditLinks = hasPermission((await getSessionUser())?.role, 'cost.write');
  try {
    const db = await getDb();
    const ratios = await getCostRatios(
      access,
      db,
      rows.map((row) => row.id),
    );
    const links = await getItemLinkCells(
      access,
      db,
      rows.map((row) => row.itemCode),
    );
    return { ratios, links, canEditLinks, failed: false };
  } catch (error) {
    logger.error('pricing.cost_ratio_failed', { error, rows: rows.length });
    return { ratios: {}, links: {}, canEditLinks, failed: true };
  }
}
