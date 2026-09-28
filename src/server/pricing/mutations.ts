import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { items, salesPrices, type SalesPrice } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';
import { assertInvariants, checkInvariants } from '@/server/imports/invariants';
import { SALES_COLUMNS } from '@/server/imports/schemas/sales';
import {
  recomputeSeriesSql,
  RESET_DELETED_ROWS_SQL,
  salesSeriesKey,
} from '@/server/imports/series';

import {
  createPolicySchema,
  deletePolicySchema,
  updatePolicySchema,
  type DeletePolicyInput,
  type PolicyFields,
  type PolicyInput,
  type UpdatePolicyInput,
} from './schemas';

/**
 * 가격정책 등록·수정·삭제 (§4.5.3, R-08·R-10). 권한은 호출자(runAction, pricing.write)가 검사한다.
 * 한 트랜잭션에서: 변경 → 해당 계열만 2~4단계 재계산 → 불변식 I-1/I-2 검사 → 감사 로그(변경 전/후 원본 20컬럼 + 사유).
 */
export type PricingContext = { handle: DbHandle; actor: AuditActor; meta: RequestMeta };

export type PolicyResult = {
  id: number;
  operationStatus: '운영중' | '미사용';
  /** 폐기 품목이라 운영중이 될 수 없어 미사용으로 저장됐는지 (AC-23 안내) */
  discarded: boolean;
};

export const AUDIT_PRICE_CREATE = 'price_policy.create';
export const AUDIT_PRICE_UPDATE = 'price_policy.update';
export const AUDIT_PRICE_DELETE = 'price_policy.delete';

/** 감사 로그용 원본 20컬럼 스냅샷 (+ source) */
export function sourceSnapshot(row: SalesPrice): Record<string, unknown> {
  const snapshot = Object.fromEntries(SALES_COLUMNS.map(({ key }) => [key, row[key]]));
  return { ...snapshot, source: row.source };
}

function values(fields: PolicyFields, actorId: string | null) {
  const { reason: _reason, ...columns } = fields;
  void _reason;
  return { ...columns, source: 'manual' as const, importBatchId: null, updatedBy: actorId };
}

async function findActive(tx: Tx, id: number): Promise<SalesPrice> {
  const [row] = await tx
    .select()
    .from(salesPrices)
    .where(and(eq(salesPrices.id, id), isNull(salesPrices.deletedAt)));
  if (!row) throw new AppError('NOT_FOUND', '가격정책을 찾을 수 없습니다');
  return row;
}

/** 같은 계열·적용시작일의 활성 행이 있으면 CONFLICT (부분 UNIQUE 인덱스와 같은 규칙) */
async function guardDuplicate(tx: Tx, fields: PolicyFields, exceptId?: number) {
  const key = salesSeriesKey(fields);
  const [clash] = await tx
    .select({ id: salesPrices.id })
    .from(salesPrices)
    .where(
      and(
        eq(salesPrices.seriesKey, key),
        eq(salesPrices.effectiveFrom, fields.effectiveFrom),
        isNull(salesPrices.deletedAt),
        exceptId ? ne(salesPrices.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) {
    throw new AppError('CONFLICT', '같은 계열·적용시작일의 가격정책이 이미 있습니다', {
      effectiveFrom: ['같은 품번·단가유형·단가구분·화폐·거래처코드에 같은 적용시작일이 있습니다'],
    });
  }
}

/** 해당 계열만 재계산하고 불변식을 확인한 뒤 저장 결과를 돌려준다 */
async function recomputeAndVerify(tx: Tx, seriesKeys: string[], id: number): Promise<PolicyResult> {
  await tx.execute(recomputeSeriesSql([...new Set(seriesKeys)]));
  await tx.execute(RESET_DELETED_ROWS_SQL);
  assertInvariants(await checkInvariants(tx));
  const [row] = await tx
    .select({
      status: salesPrices.operationStatus,
      latest: salesPrices.isLatestInSeries,
      item: items.itemStatus,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(eq(salesPrices.id, id));
  return {
    id,
    operationStatus: row?.status ?? '미사용',
    discarded: row?.item === '폐기',
  };
}

export async function createPricePolicy(
  ctx: PricingContext,
  raw: PolicyInput,
): Promise<PolicyResult> {
  const fields = createPolicySchema.parse(raw);
  return withTransaction(async (tx) => {
    await guardDuplicate(tx, fields);
    const created = firstRow(
      await tx
        .insert(salesPrices)
        .values({
          ...values(fields, ctx.actor.id),
          sourceId: 0,
          isFinalSource: false,
          createdBy: ctx.actor.id,
        })
        .returning(),
      'sales_prices insert',
    );
    const result = await recomputeAndVerify(tx, [created.seriesKey], created.id);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_PRICE_CREATE,
      target: {
        type: 'sales_price',
        id: String(created.id),
        label: `${created.itemCode} ${created.itemName}`,
      },
      after: { ...sourceSnapshot(created), operationStatus: result.operationStatus },
      reason: fields.reason,
      meta: ctx.meta,
    });
    return result;
  }, ctx.handle);
}

/** 수정: ERP 행도 허용하되 source 를 manual 로 바꾸고 원본 스냅샷을 before 에 남긴다 (§4.5.3) */
export async function updatePricePolicy(
  ctx: PricingContext,
  raw: UpdatePolicyInput,
): Promise<PolicyResult> {
  const { id, ...fields } = updatePolicySchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    await guardDuplicate(tx, fields, id);
    const updated = firstRow(
      await tx
        .update(salesPrices)
        .set({ ...values(fields, ctx.actor.id), updatedAt: new Date() })
        .where(eq(salesPrices.id, id))
        .returning(),
      'sales_prices update',
    );
    const result = await recomputeAndVerify(tx, [before.seriesKey, updated.seriesKey], id);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_PRICE_UPDATE,
      target: {
        type: 'sales_price',
        id: String(id),
        label: `${updated.itemCode} ${updated.itemName}`,
      },
      before: sourceSnapshot(before),
      after: { ...sourceSnapshot(updated), operationStatus: result.operationStatus },
      reason: fields.reason,
      meta: ctx.meta,
    });
    return result;
  }, ctx.handle);
}

/** 삭제: soft delete + 사유 필수 + 계열 재계산 (§4.5.3) */
export async function deletePricePolicy(
  ctx: PricingContext,
  raw: DeletePolicyInput,
): Promise<{ id: number }> {
  const { id, reason } = deletePolicySchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    await tx
      .update(salesPrices)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.actor.id })
      .where(eq(salesPrices.id, id));
    await recomputeAndVerify(tx, [before.seriesKey], id);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_PRICE_DELETE,
      target: {
        type: 'sales_price',
        id: String(id),
        label: `${before.itemCode} ${before.itemName}`,
      },
      before: sourceSnapshot(before),
      after: { deletedAt: 'now' },
      reason,
      meta: ctx.meta,
    });
    return { id };
  }, ctx.handle);
}

/** 등록 모달 품번 조회: 품목 마스터의 품명·상태(폐기 안내용)와 최근 판매단가의 제품군 */
export async function lookupItem(handle: DbHandle, itemCode: string) {
  const code = itemCode.trim();
  if (!code) return null;
  const [row] = await handle.db
    .select({
      itemCode: salesPrices.itemCode,
      itemName: salesPrices.itemName,
      productFamily: salesPrices.productFamily,
      unit: salesPrices.unit,
      itemStatus: sql<string | null>`${items.itemStatus}::text`,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(and(eq(salesPrices.itemCode, code), isNull(salesPrices.deletedAt)))
    .orderBy(sql`${salesPrices.effectiveFrom} desc`)
    .limit(1);
  if (row) return row;
  const [item] = await handle.db
    .select({
      itemCode: items.itemCode,
      itemName: items.itemName,
      itemStatus: sql<string | null>`${items.itemStatus}::text`,
    })
    .from(items)
    .where(eq(items.itemCode, code));
  return item ? { ...item, productFamily: null, unit: null } : null;
}
