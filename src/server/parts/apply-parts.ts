import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { importBatches, stgPartMappings } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit } from '@/server/audit/log';

import { ensureItemStubs, replaceModelMapping, type PartsContext } from './mutations';
import { applyPartImportSchema, type ApplyPartImportInput } from './schemas';

/**
 * 파츠 엑셀 적용 (§4.3.6, §4.5.6 엑셀 등록 모드, AC-32): 검증 통과 배치(존재하지 않는 품번은 업로드 단계에서
 * 이미 오류 목록) → 모델별로 묶어 전체 교체 → 배치 applied → 감사 `part_import.apply`.
 * 여러 번 적용해도 결과는 같다(모델별 교체이므로 멱등).
 */
export const AUDIT_PART_IMPORT_APPLY = 'part_import.apply';

export type PartApplyStats = {
  models: number;
  mappings: number;
  /** 기존 매핑을 덮어쓴 모델 수 */
  replacedModels: number;
};

async function groupedRows(tx: Tx, batchId: string): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({ model: stgPartMappings.modelItemCode, part: stgPartMappings.partItemCode })
    .from(stgPartMappings)
    .where(eq(stgPartMappings.batchId, batchId))
    .orderBy(asc(stgPartMappings.rowIndex));
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const parts = groups.get(row.model) ?? [];
    if (!parts.includes(row.part) && row.part !== row.model) parts.push(row.part);
    groups.set(row.model, parts);
  }
  return groups;
}

export async function applyPartImport(
  ctx: PartsContext,
  raw: ApplyPartImportInput,
): Promise<PartApplyStats> {
  const input = applyPartImportSchema.parse(raw);
  const [batch] = await ctx.handle.db
    .select()
    .from(importBatches)
    .where(eq(importBatches.id, input.batchId));
  if (!batch || batch.kind !== 'part_mapping') {
    throw new AppError('NOT_FOUND', '파츠 배치를 찾을 수 없습니다');
  }
  if (batch.status === 'failed' || batch.errorCount > 0) {
    throw new AppError(
      'VALIDATION',
      `파츠 파일에 오류가 있어 적용할 수 없습니다 (${batch.fileName})`,
    );
  }
  return withTransaction(async (tx) => {
    const groups = await groupedRows(tx, batch.id);
    const codes = [...groups.entries()].flatMap(([model, parts]) => [model, ...parts]);
    const unknown = await ensureItemStubs(tx, codes);
    if (unknown.length > 0) {
      throw new AppError('VALIDATION', `존재하지 않는 품번입니다: ${unknown.join(', ')}`);
    }
    let mappings = 0;
    let replacedModels = 0;
    for (const [model, parts] of groups) {
      if (parts.length === 0) continue;
      const before = await replaceModelMapping(tx, model, parts, {
        createdBy: ctx.actor.id,
        importBatchId: batch.id,
      });
      mappings += parts.length;
      if (before.length > 0) replacedModels += 1;
    }
    const stats: PartApplyStats = { models: groups.size, mappings, replacedModels };
    await tx
      .update(importBatches)
      .set({ status: 'applied', updatedAt: new Date() })
      .where(eq(importBatches.id, batch.id));
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_PART_IMPORT_APPLY,
      target: { type: 'import_batch', id: batch.id, label: batch.fileName },
      after: { ...stats, batchId: batch.id },
      meta: ctx.meta,
    });
    return stats;
  }, ctx.handle);
}
