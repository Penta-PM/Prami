import 'server-only';

import { getDb } from '@/db';
import { optionalCostReadAccess } from '@/server/cost/access';
import { getCostRatios, type CostRatio } from '@/server/cost/price-ratio';

export type { CostRatio, CostRatioReason } from '@/server/cost/price-ratio';

/**
 * 가격정책 관리 표의 원가 비중 (스펙 cost-ratio-price-change §2.2·§2.3). 원가 모듈(server/cost) 밖 화면(features/pricing)이
 * 쓰는 유일한 입구 — Server Action 이 아니라 서버 컴포넌트 전용 함수라 클라이언트가 호출할 엔드포인트가 생기지 않는다.
 * cost.read 가 없으면 null → 호출 측은 열 정의·prop 자체를 만들지 않는다(RSC payload 에 costRatio 키 0).
 */
export async function loadPolicyCostRatios(
  priceRowIds: readonly number[],
): Promise<Record<number, CostRatio> | null> {
  const access = await optionalCostReadAccess();
  if (!access) return null;
  return getCostRatios(access, await getDb(), priceRowIds);
}
