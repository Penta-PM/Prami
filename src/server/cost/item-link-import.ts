import 'server-only';

import { ZodError, z } from 'zod';

import type { Db } from '@/db';
import { costItemLinks } from '@/db/schema';
import { COST_LINK_FILE_MAX_ROWS } from '@/lib/imports/cost-link-file';
import { AppError } from '@/lib/result';
import { writeAudit } from '@/server/audit/log';
import { logger, summarizeQueryError } from '@/server/log';

import { assertCostAccess, type CostAccess } from './access-token';
import {
  COST_LINK_IMPORT_REASONS,
  type ApplyCostLinkImportInput,
  type ApplyCostLinkImportResult,
  type CostLinkFamily,
  type CostLinkImportEntry,
  type CostLinkImportFailure,
  type CostLinkImportInput,
  type CostLinkImportPreview,
  type CostLinkImportReason,
} from './item-link-types';
import {
  COST_LINK_MAX_BATCH,
  confirmCostLinks,
  inScopeRow,
  materialNames,
  scopeOf,
} from './item-links';
import type { CostMutationContext } from './mutations';

/**
 * 품목-원가 매칭 파일 업로드 (스펙 erp-upload-guide §6.2, 분류 규칙 cost-ratio-price-change §9).
 *
 * 기밀(최우선): 브라우저가 파일에서 읽은 {품목코드, 자재번호} 쌍만 받는다. 미리보기 결과는 응답에만 싣고 DB·로그에 남기지
 * 않는다. 확정은 변경·추가 쌍만 기존 `confirmCostLinks`(검사·트랜잭션·행별 감사 — 수동 확정과 같은 기존 동작)로 저장하고,
 * 요약 감사 `cost_link.import` 1건에는 건수만 남긴다(파일명·목록 없음). 파일에 없는 기존 링크는 해제하지 않는다(Q-F1).
 * 서버 로그에는 쌍·품목코드 목록을 쓰지 않는다 — 오류는 코드·건수만.
 */
export const AUDIT_COST_LINK_IMPORT = 'cost_link.import';

export const COST_LINK_IMPORT_STALE_MESSAGE =
  '미리보기 이후 원가 매핑·품목·원가표가 바뀌었습니다. 다시 미리보기 하세요';
const COST_LINK_IMPORT_FAILED_MESSAGE = '매칭 파일을 처리하지 못했습니다. 잠시 후 다시 시도하세요';

/** 코드 형식: 앞뒤 공백 제거 후 1~100자, 제어 문자 없음 (확정 검사와 같은 100자 상한) */
const CODE_MAX = 100;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const validCode = (value: string) =>
  value.length >= 1 && value.length <= CODE_MAX && !CONTROL_RE.test(value);

/** 입력 상한은 파일 행 상한과 같다. 형식이 틀린 값도 요청 전체를 거부하지 않고 '형식 오류'로 분류한다 */
const pairsSchema = z.object({
  pairs: z
    .array(
      z.object({
        itemCode: z.string().max(1000).trim(),
        materialCode: z.string().max(1000).trim(),
      }),
    )
    .min(1, '매칭 파일에 품번·원자재품번 쌍이 없습니다')
    .max(
      COST_LINK_FILE_MAX_ROWS,
      `품목-원가 매칭 파일은 ${COST_LINK_FILE_MAX_ROWS.toLocaleString('ko-KR')}행까지 올릴 수 있습니다`,
    ),
});

const applySchema = pairsSchema.extend({
  expected: z.object({
    changed: z.number().int().min(0),
    added: z.number().int().min(0),
  }),
});

const emptyReasons = (): Record<CostLinkImportReason, number> =>
  Object.fromEntries(COST_LINK_IMPORT_REASONS.map((reason) => [reason, 0])) as Record<
    CostLinkImportReason,
    number
  >;

/**
 * 예상 밖 오류(DB 등)는 그대로 던지면 경계(runAction)가 오류 전체를 로그에 남긴다 — drizzle 오류 메시지에는 바인딩 값
 * (품목코드·자재번호)이 들어 있으므로 여기서 SQLSTATE 코드·건수만 기록하고 일반 문구로 바꾼다.
 */
async function withSafeErrors<T>(event: string, pairs: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    logger.error(event, { code: summarizeQueryError(error).code ?? 'INTERNAL', pairs });
    throw new AppError('INTERNAL', COST_LINK_IMPORT_FAILED_MESSAGE);
  }
}

const byItemCode = <T extends { itemCode: string }>(a: T, b: T) =>
  a.itemCode.localeCompare(b.itemCode);

/**
 * 분류 (§9-2): 쌍마다 형식 → 품목별 품번 2개 이상 → 품목 마스터 없음 → 후보 범위 밖 → 원가표에 없는 품번 →
 * 같음 / 변경 / 추가. 같은 쌍이 여러 행이면 한 번으로 센다. 쓰기 없음.
 */
async function classify(db: Db, input: CostLinkImportInput): Promise<CostLinkImportPreview> {
  const failed: CostLinkImportFailure[] = [];
  const formatKeys = new Set<string>();
  const materialsByItem = new Map<string, Set<string>>();
  for (const { itemCode, materialCode } of input.pairs) {
    if (!validCode(itemCode) || !validCode(materialCode)) {
      const key = `${itemCode}\u0000${materialCode}`;
      if (formatKeys.has(key)) continue;
      formatKeys.add(key);
      failed.push({
        itemCode: itemCode.slice(0, CODE_MAX),
        materialCodes: [materialCode.slice(0, CODE_MAX)],
        reason: 'format',
      });
      continue;
    }
    const set = materialsByItem.get(itemCode) ?? new Set<string>();
    set.add(materialCode);
    materialsByItem.set(itemCode, set);
  }
  const pairCount =
    formatKeys.size + [...materialsByItem.values()].reduce((sum, set) => sum + set.size, 0);

  const single = new Map<string, string>();
  for (const [itemCode, set] of materialsByItem) {
    if (set.size > 1) {
      failed.push({ itemCode, materialCodes: [...set].sort(), reason: 'multiple' });
    } else {
      single.set(itemCode, [...set][0]!);
    }
  }

  // 순차 실행 — 트랜잭션(한 연결)으로 불려도 동시 쿼리가 생기지 않게
  const scope = await scopeOf(db, [...single.keys()]);
  const names = await materialNames(db, [...new Set(single.values())]);
  const links = await db
    .select({ itemCode: costItemLinks.itemCode, materialCode: costItemLinks.materialCode })
    .from(costItemLinks);
  const linkByItem = new Map(links.map((link) => [link.itemCode, link.materialCode]));
  const linkNames = await materialNames(db, [...new Set(links.map((link) => link.materialCode))]);

  let same = 0;
  const changed: CostLinkImportEntry[] = [];
  const added: CostLinkImportEntry[] = [];
  for (const [itemCode, materialCode] of single) {
    const row = scope.get(itemCode);
    const fail = (reason: CostLinkImportReason) =>
      failed.push({ itemCode, materialCodes: [materialCode], reason });
    if (!row) {
      fail('no-item');
      continue;
    }
    if (!inScopeRow(row)) {
      fail('out-of-scope');
      continue;
    }
    const materialName = names.get(materialCode);
    if (materialName === undefined) {
      fail('no-cost');
      continue;
    }
    const previous = linkByItem.get(itemCode);
    if (previous === materialCode) {
      same += 1;
      continue;
    }
    const entry: CostLinkImportEntry = {
      itemCode,
      itemName: row.itemName,
      family: row.family as CostLinkFamily,
      before: previous
        ? { materialCode: previous, materialName: linkNames.get(previous) ?? null }
        : null,
      after: { materialCode, materialName },
    };
    (previous ? changed : added).push(entry);
  }

  // 파일에 없는 기존 링크 — 유지(해제하지 않음). 제품군별 건수만
  const fileItems = new Set([...materialsByItem.keys()]);
  const keptLinks = links.filter((link) => !fileItems.has(link.itemCode));
  const keptScope = await scopeOf(
    db,
    keptLinks.map((link) => link.itemCode),
  );
  const kept = new Map<CostLinkFamily | null, number>();
  for (const link of keptLinks) {
    const row = keptScope.get(link.itemCode);
    const family = inScopeRow(row) ? (row!.family as CostLinkFamily) : null;
    kept.set(family, (kept.get(family) ?? 0) + 1);
  }

  const failedByReason = emptyReasons();
  for (const failure of failed) failedByReason[failure.reason] += 1;
  return {
    pairs: pairCount,
    items: materialsByItem.size + formatKeys.size,
    same,
    changed: changed.sort(byItemCode),
    added: added.sort(byItemCode),
    failed: failed.sort(byItemCode),
    failedByReason,
    kept: [...kept]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => (a.family ?? '￿').localeCompare(b.family ?? '￿')),
  };
}

/** 미리보기 (쓰기 없음) — 매칭 업로드는 cost.write 화면에만 있으므로 write 범위 토큰을 요구한다 */
export async function previewCostLinkImport(
  access: CostAccess,
  db: Db,
  raw: CostLinkImportInput,
): Promise<CostLinkImportPreview> {
  assertCostAccess(access, 'write');
  const input = pairsSchema.parse(raw);
  return withSafeErrors('cost_link.import.preview_failed', input.pairs.length, () =>
    classify(db, input),
  );
}

/**
 * 확정: 다시 분류해 미리보기 때와 변경·추가 건수가 다르면 CONFLICT('다시 미리보기'). 변경·추가만 `confirmCostLinks` 로
 * (500건 초과 거부), 그다음 요약 감사 1건(건수만). 해제는 하지 않는다.
 * confirmCostLinks 의 VALIDATION 메시지는 품목코드를 나열하므로 그대로 돌려주거나 기록하지 않고 CONFLICT 로 바꾼다.
 */
export async function applyCostLinkImport(
  ctx: CostMutationContext,
  raw: ApplyCostLinkImportInput,
): Promise<ApplyCostLinkImportResult> {
  assertCostAccess(ctx.access, 'write');
  const input = applySchema.parse(raw);
  return withSafeErrors('cost_link.import.failed', input.pairs.length, () =>
    applyClassified(ctx, input),
  );
}

async function applyClassified(
  ctx: CostMutationContext,
  input: z.infer<typeof applySchema>,
): Promise<ApplyCostLinkImportResult> {
  const preview = await classify(ctx.handle.db, input);
  const links = [...preview.changed, ...preview.added].map((entry) => ({
    itemCode: entry.itemCode,
    materialCode: entry.after.materialCode,
  }));
  if (
    preview.changed.length !== input.expected.changed ||
    preview.added.length !== input.expected.added
  ) {
    logger.warn('cost_link.import.stale', { pairs: preview.pairs, links: links.length });
    throw new AppError('CONFLICT', COST_LINK_IMPORT_STALE_MESSAGE, undefined, { stale: true });
  }
  if (links.length === 0) throw new AppError('VALIDATION', '확정할 변경·추가가 없습니다');
  if (links.length > COST_LINK_MAX_BATCH) {
    throw new AppError(
      'VALIDATION',
      `한 번에 ${COST_LINK_MAX_BATCH}건까지 확정할 수 있습니다 (변경·추가 ${links.length}건)`,
    );
  }

  let result: { saved: number; unchanged: number };
  try {
    result = await confirmCostLinks(ctx, { links });
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) {
      // 메시지(품목코드 목록)는 기록하지 않는다 — 코드·건수만
      const code = error instanceof AppError ? error.code : 'VALIDATION';
      logger.warn('cost_link.import.rejected', { code, links: links.length });
      throw new AppError('CONFLICT', COST_LINK_IMPORT_STALE_MESSAGE, undefined, { stale: true });
    }
    throw error;
  }

  const summary: ApplyCostLinkImportResult = {
    saved: result.saved,
    unchanged: preview.same + result.unchanged,
    failedByReason: preview.failedByReason,
  };
  await writeAudit(ctx.handle.db, {
    actor: { id: ctx.access.userId, label: ctx.access.email },
    action: AUDIT_COST_LINK_IMPORT,
    target: { type: 'cost_item_link', id: 'import', label: '품목-원가 매칭 파일' },
    after: { ...summary },
    meta: ctx.meta,
  });
  return summary;
}
