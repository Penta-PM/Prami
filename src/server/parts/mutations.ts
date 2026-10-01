import 'server-only';

import { asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { items, partMappings, salesPrices } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';

import {
  deletePartMappingSchema,
  savePartMappingSchema,
  type DeletePartMappingInput,
  type SavePartMappingInput,
} from './schemas';

/**
 * 파츠 매핑 저장·삭제 (§4.3.6, §4.5.6 R-02). 저장 = 모델 단위 전체 교체(delete where model → insert all) 를
 * 한 트랜잭션으로, 감사 `part_mapping.save`(before/after 파츠 목록)·`part_mapping.delete`.
 * 품번은 items(FK) 에 있어야 하며, 판매단가에만 있는 품번은 stub 으로 만들어 FK 를 만족시킨다 (§4.3.6).
 */
export type PartsContext = { handle: DbHandle; actor: AuditActor; meta: RequestMeta };

export const AUDIT_PART_SAVE = 'part_mapping.save';
export const AUDIT_PART_DELETE = 'part_mapping.delete';

export type SavePartMappingResult = {
  modelItemCode: string;
  partItemCodes: string[];
  /** 기존 매핑을 덮어썼는지 (AC-31) */
  replaced: boolean;
};

/**
 * 품번이 items 에 없으면 판매단가의 품명으로 stub(분류 NULL, 상태 NULL, raw.stub=true) 생성.
 * 판매단가에도 없는 품번은 존재하지 않는 품번 → 목록으로 돌려준다.
 */
export async function ensureItemStubs(tx: Tx, codes: readonly string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return [];
  const known = new Set(
    (
      await tx.select({ code: items.itemCode }).from(items).where(inArray(items.itemCode, unique))
    ).map((row) => row.code),
  );
  const missing = unique.filter((code) => !known.has(code));
  if (missing.length === 0) return [];
  const candidates = await tx
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: salesPrices.itemName,
      importBatchId: salesPrices.importBatchId,
    })
    .from(salesPrices)
    .where(inArray(salesPrices.itemCode, missing))
    .orderBy(salesPrices.itemCode, sql`${salesPrices.effectiveFrom} desc`);
  const withBatch = candidates.filter(
    (row): row is typeof row & { importBatchId: string } => row.importBatchId !== null,
  );
  if (withBatch.length > 0) {
    await tx.insert(items).values(
      withBatch.map((row) => ({
        itemCode: row.itemCode,
        itemName: row.itemName,
        importBatchId: row.importBatchId,
        // 마스터에 없는 판매단가 품번 = stub (PRAMI-003 §4.2.8 — 종류는 '기타'로 표시)
        source: 'stub' as const,
      })),
    );
  }
  const created = new Set(withBatch.map((row) => row.itemCode));
  return missing.filter((code) => !created.has(code));
}

async function assertCodesExist(tx: Tx, codes: readonly string[]) {
  const unknown = await ensureItemStubs(tx, codes);
  if (unknown.length > 0) {
    throw new AppError('VALIDATION', `존재하지 않는 품번입니다: ${unknown.join(', ')}`, {
      partItemCodes: unknown.map((code) => `${code}: 품목 마스터·판매단가에 없는 품번입니다`),
    });
  }
}

async function currentParts(tx: Tx, modelItemCode: string): Promise<string[]> {
  const rows = await tx
    .select({ code: partMappings.partItemCode })
    .from(partMappings)
    .where(eq(partMappings.modelItemCode, modelItemCode))
    .orderBy(asc(partMappings.sortOrder), asc(partMappings.id));
  return rows.map((row) => row.code);
}

/** 트랜잭션 안에서 모델 매핑 전체 교체 (수동 저장·엑셀 적용 공용). 반환 = 교체 전 파츠 목록 */
export async function replaceModelMapping(
  tx: Tx,
  modelItemCode: string,
  partItemCodes: readonly string[],
  meta: { createdBy: string | null; importBatchId?: string | null },
): Promise<string[]> {
  const before = await currentParts(tx, modelItemCode);
  await tx.delete(partMappings).where(eq(partMappings.modelItemCode, modelItemCode));
  await tx.insert(partMappings).values(
    partItemCodes.map((partItemCode, index) => ({
      modelItemCode,
      partItemCode,
      sortOrder: index,
      importBatchId: meta.importBatchId ?? null,
      createdBy: meta.createdBy,
    })),
  );
  return before;
}

async function modelLabel(tx: Tx, modelItemCode: string): Promise<string> {
  const [row] = await tx
    .select({ name: items.itemName })
    .from(items)
    .where(eq(items.itemCode, modelItemCode));
  return row ? `${row.name} (${modelItemCode})` : modelItemCode;
}

export async function savePartMapping(
  ctx: PartsContext,
  raw: SavePartMappingInput,
): Promise<SavePartMappingResult> {
  const input = savePartMappingSchema.parse(raw);
  return withTransaction(async (tx) => {
    await assertCodesExist(tx, [input.modelItemCode, ...input.partItemCodes]);
    const before = await replaceModelMapping(tx, input.modelItemCode, input.partItemCodes, {
      createdBy: ctx.actor.id,
    });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_PART_SAVE,
      target: {
        type: 'part_mapping',
        id: input.modelItemCode,
        label: await modelLabel(tx, input.modelItemCode),
      },
      before: before.length > 0 ? { partItemCodes: before } : null,
      after: { partItemCodes: input.partItemCodes },
      meta: ctx.meta,
    });
    return {
      modelItemCode: input.modelItemCode,
      partItemCodes: input.partItemCodes,
      replaced: before.length > 0,
    };
  }, ctx.handle);
}

export async function deletePartMapping(ctx: PartsContext, raw: DeletePartMappingInput) {
  const { modelItemCode } = deletePartMappingSchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await currentParts(tx, modelItemCode);
    if (before.length === 0) throw new AppError('NOT_FOUND', '등록된 매핑이 없습니다');
    await tx.delete(partMappings).where(eq(partMappings.modelItemCode, modelItemCode));
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_PART_DELETE,
      target: {
        type: 'part_mapping',
        id: modelItemCode,
        label: await modelLabel(tx, modelItemCode),
      },
      before: { partItemCodes: before },
      after: { partItemCodes: [] },
      meta: ctx.meta,
    });
    return { modelItemCode, removed: before.length };
  }, ctx.handle);
}

/** 활성 판매단가가 있는 품번인지 (등록 모달 검증용) */
export async function hasActiveSalesPrice(tx: Tx, itemCode: string): Promise<boolean> {
  const [row] = await tx
    .select({ code: salesPrices.itemCode })
    .from(salesPrices)
    .where(sql`${salesPrices.itemCode} = ${itemCode} and ${isNull(salesPrices.deletedAt)}`)
    .limit(1);
  return Boolean(row);
}
