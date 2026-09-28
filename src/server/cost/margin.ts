import 'server-only';

import { z } from 'zod';

import { hasPermission } from '@/lib/constants/permissions';
import { computeNetSales, type NetSalesResult } from '@/lib/pricing/margin';
import type { SessionUser } from '@/server/auth/session-user';

/**
 * 순매출 계산기 원가 잠금 (§4.5.5). USER 는 원가 입력을 무시하고(잠금) 원가·이익·이익률을 계산·반환하지 않는다.
 * ADMIN(cost.read)만 unitCost 를 넣어 원가 결과를 받는다. 화면은 PR-7.
 */
export const netSalesInputSchema = z.object({
  sellingPrice: z.coerce.number().min(0).max(1e15),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  discountRate: z.coerce.number().min(0).max(100).default(0),
  unitCost: z.coerce.number().min(0).max(1e15).nullish(),
  /** 기타 비용 (총액, §4.5.7) */
  miscCost: z.coerce.number().min(0).max(1e15).default(0),
});

export type NetSalesActionInput = z.input<typeof netSalesInputSchema>;

export type NetSalesOutcome = NetSalesResult & { costLocked: boolean };

export function calculateNetSalesFor(
  user: Pick<SessionUser, 'role'>,
  raw: NetSalesActionInput,
): NetSalesOutcome {
  const input = netSalesInputSchema.parse(raw);
  const canSeeCost = hasPermission(user.role, 'cost.read');
  const result = computeNetSales({
    ...input,
    unitCost: canSeeCost ? input.unitCost : null,
  });
  return { ...result, costLocked: !canSeeCost };
}
