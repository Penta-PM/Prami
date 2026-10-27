'use server';

import { z } from 'zod';

import { getDb } from '@/db';
import { isMonthKey } from '@/lib/month';
import { ISIGN_PRODUCT_GROUPS, PROCUREMENT_PRODUCT_TABS } from '@/lib/procurement/constants';
import type { ActionResult } from '@/lib/result';
import { runAction } from '@/server/auth/rbac';
import { AUDIT_PROCUREMENT_READ, requireProcurementAccess } from '@/server/procurement/access';
import {
  getMonthlyReportByManufacturer,
  getYearlyPerformance,
  type MonthlyReportRow,
  type PerformanceScope,
  type YearlyPerformance,
} from '@/server/procurement/queries';

/**
 * 조달 실적 현황 모달용 조회 (조달이 통합 UI-5, procurement.read). 페이지 첫 화면에는 요약만 싣고, 모달을 열 때만
 * 전체(제조사별 실적표 · 연도별 표 전체)를 가져온다. 거부 = FORBIDDEN 봉투 + 감사 procurement.read denied.
 */
const scopeSchema = z.object({
  tab: z.enum(PROCUREMENT_PRODUCT_TABS),
  group: z.enum(ISIGN_PRODUCT_GROUPS).nullable(),
});

const monthSchema = z.string().refine(isMonthKey, '월 형식이 아닙니다 (YYYY-MM)');

function scopeOf(input: z.infer<typeof scopeSchema>): PerformanceScope {
  return { product: input.tab, group: input.tab === 'iSIGN' ? input.group : null };
}

/** 월 실적 보고표 "제조사별 실적표" — 기준월·누적·전년 한 해 (getMonthlyReportByManufacturer) */
export async function getManufacturerReportAction(input: {
  tab: string;
  group: string | null;
  month: string;
}): Promise<ActionResult<MonthlyReportRow[]>> {
  const guard = {
    permission: 'procurement.read',
    auditAction: AUDIT_PROCUREMENT_READ,
    name: 'getManufacturerReport',
  } as const;
  return runAction(guard, async () => {
    const parsed = scopeSchema.extend({ month: monthSchema }).parse(input);
    const access = await requireProcurementAccess('read', 'action:getManufacturerReport');
    return getMonthlyReportByManufacturer(access, await getDb(), {
      scope: scopeOf(parsed),
      month: parsed.month,
    });
  });
}

/** 연도별 매출·점유율 "더보기" — 제조사 전체 (manufacturerLimit 없음) */
export async function getYearlyPerformanceAllAction(input: {
  tab: string;
  group: string | null;
}): Promise<ActionResult<YearlyPerformance>> {
  const guard = {
    permission: 'procurement.read',
    auditAction: AUDIT_PROCUREMENT_READ,
    name: 'getYearlyPerformanceAll',
  } as const;
  return runAction(guard, async () => {
    const parsed = scopeSchema.parse(input);
    const access = await requireProcurementAccess('read', 'action:getYearlyPerformanceAll');
    return getYearlyPerformance(access, await getDb(), {
      scope: scopeOf(parsed),
      manufacturerLimit: null,
    });
  });
}
