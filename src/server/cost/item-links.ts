import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '@/db';
import { costItemLinks, items, materialCosts, salesPrices } from '@/db/schema';
import { withTransaction } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit } from '@/server/audit/log';

import { assertCostAccess, type CostAccess } from './access-token';
import { buildMaterialIndex, suggestMaterial } from './item-link-suggest';
import type {
  ConfirmCostLinksInput,
  ConfirmCostLinksResult,
  CostLinkCandidate,
  CostLinkFamily,
  CostLinkMaterial,
  CostLinkOrphan,
  CostLinkPickerData,
  CostLinkView,
  DeleteCostLinkInput,
  DeleteCostLinkResult,
  ItemLinkCell,
} from './item-link-types';
import type { CostMutationContext } from './mutations';

/**
 * 원가 매핑 조회·확정·해제 (스펙 cost-ratio-price-change §2.1). 원가 금액은 읽지도 돌려주지도 않는다(자재번호·자재명만).
 *
 * 후보 범위 (실데이터 확인, 2026-10-15 main DB — 본품만):
 * - WAPPLES: 대분류 `WAPPLES` 이고 중분류 또는 소분류가 `H/W Appliance`
 *   (현행 `H/W Appliance`/`Wapples`·`Wapples-CC` + 구 분류 `Wapples Product`·`Wapples-CC`·`Wapples-MS` / `H/W Appliance`)
 * - D.AMO KMS: 중분류 `D'Amo KMS` 이고 소분류 `SG-KMS`·`SG-RST`(Rest API 판). SA·SC(가상·S/W)·Optional Package·NIC 제외
 * - iSIGN: 소분류 `SS-IAT`·`SS-ATH`(대분류 iSIGN)·`SG-WCA`·`SG-WVA`(대분류 iSIGN PKI). `… SA`(S/W 어플라이언스) 제외
 * 상태(사용·폐기·임시)는 거르지 않는다 — 과거 가격 행의 비중도 매핑으로 표시되므로.
 */
export const AUDIT_COST_LINK_UPSERT = 'cost_link.upsert';
export const AUDIT_COST_LINK_DELETE = 'cost_link.delete';

export const COST_LINK_MAX_BATCH = 500;
const NORMAL_PRICE_TYPE = '정상판매';
const COST_PRICE_TYPE = '표준구매원가';
const COST_PRICE_CATEGORY = '일반';

export const CANDIDATE_FAMILY_SQL = sql<CostLinkFamily | null>`case
  when ${items.categoryMajor} = 'WAPPLES'
   and (${items.categoryMid} = 'H/W Appliance' or ${items.categoryMinor} = 'H/W Appliance') then 'WAPPLES'
  when ${items.categoryMid} = 'D''Amo KMS' and ${items.categoryMinor} in ('SG-KMS', 'SG-RST') then 'D.AMO KMS'
  when ${items.categoryMinor} in ('SS-IAT', 'SS-ATH', 'SG-WCA', 'SG-WVA') then 'iSIGN'
end`;

const iso = (value: Date | null) => (value ?? new Date(0)).toISOString();

/** 수동 선택용 자재 목록: 표준구매원가·일반·삭제 제외, 자재번호마다 최근 적용 행의 자재명 */
async function listMaterials(db: Db): Promise<CostLinkMaterial[]> {
  const rows = await db
    .selectDistinctOn([materialCosts.materialCode], {
      materialCode: materialCosts.materialCode,
      materialName: materialCosts.materialName,
    })
    .from(materialCosts)
    .where(
      and(
        isNull(materialCosts.deletedAt),
        eq(materialCosts.priceType, COST_PRICE_TYPE),
        eq(materialCosts.priceCategory, COST_PRICE_CATEGORY),
      ),
    )
    .orderBy(materialCosts.materialCode, sql`${materialCosts.effectiveFrom} desc`);
  return rows.sort(
    (a, b) =>
      a.materialName.localeCompare(b.materialName, 'ko') ||
      a.materialCode.localeCompare(b.materialCode),
  );
}

export async function listCostLinkView(access: CostAccess, db: Db): Promise<CostLinkView> {
  assertCostAccess(access, 'read');
  const family = CANDIDATE_FAMILY_SQL;
  // 순차 실행 — 트랜잭션(한 연결)으로 불려도 동시 쿼리가 생기지 않게(dry-run 스크립트는 READ ONLY 트랜잭션)
  const candidateRows = await db
    .select({
      itemCode: items.itemCode,
      itemName: items.itemName,
      family,
      categoryMinor: items.categoryMinor,
      itemStatus: items.itemStatusRaw,
      // 하위 쿼리 안에서는 drizzle 이 컬럼을 테이블 없이 렌더링하므로 테이블을 명시한다
      hasNormalPrice: sql<boolean>`exists (
          select 1 from "sales_prices" sp
          where sp."item_code" = "items"."item_code"
            and sp."price_type" = ${NORMAL_PRICE_TYPE}
            and sp."deleted_at" is null)`,
    })
    .from(items)
    .where(and(eq(items.itemKind, '본품'), sql`${family} is not null`))
    .orderBy(family, items.itemName, items.itemCode);
  const links = await db.select().from(costItemLinks);
  const materials = await listMaterials(db);
  const names = new Map(materials.map((m) => [m.materialCode, m.materialName]));
  const linkByItem = new Map(links.map((link) => [link.itemCode, link]));
  const index = buildMaterialIndex(materials);

  const candidates: CostLinkCandidate[] = candidateRows.map((row) => {
    const link = linkByItem.get(row.itemCode);
    const fam = row.family as CostLinkFamily;
    const suggested = suggestMaterial(row.itemName, fam, index);
    return {
      itemCode: row.itemCode,
      itemName: row.itemName,
      family: fam,
      categoryMinor: row.categoryMinor,
      itemStatus: row.itemStatus,
      hasNormalPrice: Boolean(row.hasNormalPrice),
      link: link
        ? {
            materialCode: link.materialCode,
            materialName: names.get(link.materialCode) ?? null,
            updatedAt: iso(link.updatedAt ?? link.createdAt),
          }
        : null,
      suggestion: 'suggestion' in suggested ? suggested.suggestion : null,
      noSuggestion: 'reason' in suggested ? suggested.reason : null,
    };
  });

  // 품목 마스터에 없는 링크(가격 임포트로 사라진 품번) — 후보 밖이지만 items 에 있는 품목은 고아가 아니다
  // 링크 품목의 마스터 존재·후보 여부 — 마스터에 없으면 고아('품목 없음'), 있지만 후보 밖이면 '후보 밖 링크'(Plan Q1 A)
  const linkedItems = links.length
    ? new Map(
        (
          await db
            .select({
              itemCode: items.itemCode,
              itemName: items.itemName,
              family,
              itemKind: items.itemKind,
            })
            .from(items)
            .where(
              inArray(
                items.itemCode,
                links.map((link) => link.itemCode),
              ),
            )
        ).map((row) => [row.itemCode, row]),
      )
    : new Map<
        string,
        { itemName: string; family: CostLinkFamily | null; itemKind: string | null }
      >();
  const toEntry = (link: (typeof links)[number]): CostLinkOrphan => ({
    itemCode: link.itemCode,
    materialCode: link.materialCode,
    materialName: names.get(link.materialCode) ?? null,
    updatedAt: iso(link.updatedAt ?? link.createdAt),
  });
  const byCode = (a: CostLinkOrphan, b: CostLinkOrphan) => a.itemCode.localeCompare(b.itemCode);
  const orphans = links
    .filter((link) => !linkedItems.has(link.itemCode))
    .map(toEntry)
    .sort(byCode);
  const outOfScope = links
    .filter((link) => {
      const item = linkedItems.get(link.itemCode);
      return item && !(item.family && item.itemKind === '본품');
    })
    .map((link) => ({ ...toEntry(link), itemName: linkedItems.get(link.itemCode)!.itemName }))
    .sort(byCode);

  return { candidates, orphans, outOfScope, materials };
}

/** 한 번에 조회하는 품목 수 상한 — 가격정책 관리 표는 현재 페이지(최대 200행)의 품목만 보낸다 */
export const ITEM_LINK_CELLS_MAX = 200;

/** 자재번호 → 원가표(표준구매원가·일반, 삭제 제외) 최근 자재명. 원가표에 없는 번호는 빠진다 */
export async function materialNames(
  db: Db,
  codes: readonly string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([materialCosts.materialCode], {
      materialCode: materialCosts.materialCode,
      materialName: materialCosts.materialName,
    })
    .from(materialCosts)
    .where(
      and(
        inArray(materialCosts.materialCode, [...codes]),
        isNull(materialCosts.deletedAt),
        eq(materialCosts.priceType, COST_PRICE_TYPE),
        eq(materialCosts.priceCategory, COST_PRICE_CATEGORY),
      ),
    )
    .orderBy(materialCosts.materialCode, sql`${materialCosts.effectiveFrom} desc`);
  return new Map(rows.map((row) => [row.materialCode, row.materialName]));
}

/** 품목코드들의 후보 범위 여부(본품 + 대상 제품군) — 품목 마스터에 없으면 범위 밖 */
export async function scopeOf(db: Db, codes: readonly string[]) {
  if (codes.length === 0) return new Map<string, ScopeRow>();
  const rows = await db
    .select({
      itemCode: items.itemCode,
      itemName: items.itemName,
      family: CANDIDATE_FAMILY_SQL,
      itemKind: items.itemKind,
      categoryMinor: items.categoryMinor,
      itemStatus: items.itemStatusRaw,
    })
    .from(items)
    .where(inArray(items.itemCode, [...codes]));
  return new Map(rows.map((row) => [row.itemCode, row]));
}
export type ScopeRow = {
  itemCode: string;
  itemName: string;
  family: CostLinkFamily | null;
  itemKind: string | null;
  categoryMinor: string | null;
  itemStatus: string | null;
};
export const inScopeRow = (row: ScopeRow | undefined) =>
  Boolean(row && row.family && row.itemKind === '본품');

/**
 * 가격정책 관리 표 '원가 매핑' 칸 (스펙 policy-cost-link-column §2.2-1): 품목코드 → 후보 범위 여부 + 매핑(자재번호·자재명·원가표 존재).
 * 현재 페이지 품목만(최대 200). 요청한 품목코드마다 항목이 있다. 원가 금액은 읽지 않는다.
 */
export async function getItemLinkCells(
  access: CostAccess,
  db: Db,
  itemCodes: readonly string[],
): Promise<Record<string, ItemLinkCell>> {
  assertCostAccess(access, 'read');
  const codes = [...new Set(itemCodes.filter((c) => typeof c === 'string' && c !== ''))].slice(
    0,
    ITEM_LINK_CELLS_MAX,
  );
  if (codes.length === 0) return {};
  const scope = await scopeOf(db, codes);
  const links = await db
    .select({ itemCode: costItemLinks.itemCode, materialCode: costItemLinks.materialCode })
    .from(costItemLinks)
    .where(inArray(costItemLinks.itemCode, codes));
  const names = await materialNames(db, [...new Set(links.map((link) => link.materialCode))]);
  const linkByItem = new Map(links.map((link) => [link.itemCode, link.materialCode]));
  const result: Record<string, ItemLinkCell> = {};
  for (const itemCode of codes) {
    const materialCode = linkByItem.get(itemCode);
    const materialName = materialCode ? (names.get(materialCode) ?? null) : null;
    result[itemCode] = {
      inScope: inScopeRow(scope.get(itemCode)),
      link: materialCode
        ? { materialCode, materialName, inCostTable: materialName !== null }
        : null,
    };
  }
  return result;
}

/**
 * 가격정책 관리 매핑 수정 모달 (스펙 policy-cost-link-column §2.3-2): 품목 요약·현재 매핑·제안(#53 휴리스틱)·자재 목록·영향 건수.
 * 품목 마스터에 없으면 가격 행의 품명으로 요약(범위 밖). 둘 다 없으면 NOT_FOUND. 원가 금액 없음.
 */
export async function getCostLinkPicker(
  access: CostAccess,
  db: Db,
  rawItemCode: string,
): Promise<CostLinkPickerData> {
  assertCostAccess(access, 'read');
  const itemCode = z.string().trim().min(1).max(100).parse(rawItemCode);
  const row = (await scopeOf(db, [itemCode])).get(itemCode);
  const [impact] = await db
    .select({
      priceRows: sql<number>`count(*)::int`,
      normalPriceRows: sql<number>`(count(*) filter (where ${salesPrices.priceType} = ${NORMAL_PRICE_TYPE}))::int`,
      itemName: sql<string | null>`max(${salesPrices.itemName})`,
    })
    .from(salesPrices)
    .where(and(eq(salesPrices.itemCode, itemCode), isNull(salesPrices.deletedAt)));
  const itemName = row?.itemName ?? impact?.itemName ?? null;
  if (itemName === null) throw new AppError('NOT_FOUND', '품목을 찾을 수 없습니다');
  const [linkRow] = await db
    .select({ materialCode: costItemLinks.materialCode })
    .from(costItemLinks)
    .where(eq(costItemLinks.itemCode, itemCode));
  const materials = await listMaterials(db);
  const names = new Map(materials.map((m) => [m.materialCode, m.materialName]));
  const inScope = inScopeRow(row);
  const family = inScope ? (row!.family as CostLinkFamily) : null;
  const suggested = family
    ? suggestMaterial(itemName, family, buildMaterialIndex(materials))
    : null;
  const materialName = linkRow ? (names.get(linkRow.materialCode) ?? null) : null;
  return {
    item: {
      itemCode,
      itemName,
      family,
      categoryMinor: row?.categoryMinor ?? null,
      itemStatus: row?.itemStatus ?? null,
      inScope,
    },
    link: linkRow
      ? { materialCode: linkRow.materialCode, materialName, inCostTable: materialName !== null }
      : null,
    suggestion: suggested && 'suggestion' in suggested ? suggested.suggestion : null,
    noSuggestion: suggested && 'reason' in suggested ? suggested.reason : null,
    materials,
    impact: {
      priceRows: Number(impact?.priceRows ?? 0),
      normalPriceRows: Number(impact?.normalPriceRows ?? 0),
    },
  };
}

const code = (label: string) => z.string().trim().min(1, `${label}를 입력하세요`).max(100);

const confirmSchema = z.object({
  links: z
    .array(z.object({ itemCode: code('품목코드'), materialCode: code('자재번호') }))
    .min(1, '확정할 행을 선택하세요')
    .max(COST_LINK_MAX_BATCH, `한 번에 ${COST_LINK_MAX_BATCH}건까지 확정할 수 있습니다`),
});

const deleteSchema = z.object({ itemCode: code('품목코드') });

function actor(ctx: CostMutationContext) {
  return { id: ctx.access.userId, label: ctx.access.email };
}

/**
 * 확정(단건·일괄): 품목이 품목 마스터에 있고 자재번호가 원가표(표준구매원가·일반, 삭제 제외)에 있을 때만 저장한다.
 * 같은 품목이 이미 같은 자재로 매핑돼 있으면 건드리지 않는다(unchanged). 바뀐 행마다 감사 1건(변경 전·후 자재번호).
 */
export async function confirmCostLinks(
  ctx: CostMutationContext,
  raw: ConfirmCostLinksInput,
): Promise<ConfirmCostLinksResult> {
  assertCostAccess(ctx.access, 'write');
  const { links } = confirmSchema.parse(raw);
  const byItem = new Map<string, string>();
  for (const link of links) {
    const existing = byItem.get(link.itemCode);
    if (existing && existing !== link.materialCode) {
      throw new AppError('VALIDATION', `같은 품목(${link.itemCode})에 서로 다른 자재가 있습니다`);
    }
    byItem.set(link.itemCode, link.materialCode);
  }
  const itemCodes = [...byItem.keys()];
  const materialCodes = [...new Set(byItem.values())];

  return withTransaction(async (tx) => {
    const itemRows = await tx
      .select({
        itemCode: items.itemCode,
        itemName: items.itemName,
        family: CANDIDATE_FAMILY_SQL,
        itemKind: items.itemKind,
      })
      .from(items)
      .where(inArray(items.itemCode, itemCodes));
    const knownItems = new Map(itemRows.map((row) => [row.itemCode, row.itemName]));
    const missingItems = itemCodes.filter((itemCode) => !knownItems.has(itemCode));
    if (missingItems.length) {
      throw new AppError('VALIDATION', `품목 마스터에 없는 품목입니다: ${missingItems.join(', ')}`);
    }
    // 후보 범위(§2.1 후보 조건 — 본품 + 대상 제품군 분류) 밖 품목은 저장하지 않는다(Plan Q1 A, QA #53 백로그 1)
    const outOfScope = itemRows
      .filter((row) => !(row.family && row.itemKind === '본품'))
      .map((row) => row.itemCode);
    if (outOfScope.length) {
      throw new AppError(
        'VALIDATION',
        `원가 매핑 후보가 아닌 품목입니다: ${outOfScope.join(', ')}`,
      );
    }
    const knownMaterials = new Set(
      (
        await tx
          .selectDistinct({ materialCode: materialCosts.materialCode })
          .from(materialCosts)
          .where(
            and(
              inArray(materialCosts.materialCode, materialCodes),
              isNull(materialCosts.deletedAt),
              eq(materialCosts.priceType, COST_PRICE_TYPE),
              eq(materialCosts.priceCategory, COST_PRICE_CATEGORY),
            ),
          )
      ).map((row) => row.materialCode),
    );
    const missingMaterials = materialCodes.filter(
      (materialCode) => !knownMaterials.has(materialCode),
    );
    if (missingMaterials.length) {
      throw new AppError(
        'VALIDATION',
        `원가표에 없는 자재번호입니다: ${missingMaterials.join(', ')}`,
      );
    }
    const before = new Map(
      (await tx.select().from(costItemLinks).where(inArray(costItemLinks.itemCode, itemCodes))).map(
        (row) => [row.itemCode, row.materialCode],
      ),
    );

    let saved = 0;
    let unchanged = 0;
    for (const [itemCode, materialCode] of byItem) {
      const previous = before.get(itemCode) ?? null;
      if (previous === materialCode) {
        unchanged += 1;
        continue;
      }
      await tx
        .insert(costItemLinks)
        .values({
          itemCode,
          materialCode,
          createdBy: ctx.access.userId,
          updatedBy: ctx.access.userId,
        })
        .onConflictDoUpdate({
          target: costItemLinks.itemCode,
          set: { materialCode, updatedBy: ctx.access.userId, updatedAt: new Date() },
        });
      await writeAudit(tx, {
        actor: actor(ctx),
        action: AUDIT_COST_LINK_UPSERT,
        target: {
          type: 'cost_item_link',
          id: itemCode,
          label: `${itemCode} ${knownItems.get(itemCode) ?? ''}`.trim(),
        },
        before: previous ? { materialCode: previous } : undefined,
        after: { materialCode },
        meta: ctx.meta,
      });
      saved += 1;
    }
    return { saved, unchanged };
  }, ctx.handle);
}

/** 해제(고아 링크 포함). 없으면 deleted=false(감사 없음) */
export async function deleteCostLink(
  ctx: CostMutationContext,
  raw: DeleteCostLinkInput,
): Promise<DeleteCostLinkResult> {
  assertCostAccess(ctx.access, 'write');
  const { itemCode } = deleteSchema.parse(raw);
  return withTransaction(async (tx) => {
    const [removed] = await tx
      .delete(costItemLinks)
      .where(eq(costItemLinks.itemCode, itemCode))
      .returning();
    if (!removed) return { deleted: false };
    await writeAudit(tx, {
      actor: actor(ctx),
      action: AUDIT_COST_LINK_DELETE,
      target: { type: 'cost_item_link', id: itemCode, label: itemCode },
      before: { materialCode: removed.materialCode },
      meta: ctx.meta,
    });
    return { deleted: true };
  }, ctx.handle);
}
