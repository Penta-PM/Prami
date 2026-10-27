import 'server-only';

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { auditLogs } from '@/db/schema';
import { procurementItemChanges, procurementItems } from '@/db/schema/procurement';
import { withTransaction, type Tx } from '@/db/tx';
import { PROCUREMENT_ITEM_PRODUCTS, PROCUREMENT_PRODUCTS } from '@/lib/procurement/constants';
import {
  AUDIT_PROCUREMENT_ITEM,
  isIsignDetailCategory,
  ITEM_ALREADY_PROCESSED,
  ITEM_BATCH_LIMIT,
  type ItemChangeAction,
  type ItemTarget,
} from '@/lib/procurement/item-admin';
import { AppError } from '@/lib/result';
import { toAuditRow, type RequestMeta } from '@/server/audit/log';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { ADMIN_ITEM_SELECTION, type AdminItemRow } from './admin-items';

/**
 * 품목 관리 쓰기 (조달이 통합 UI-7, D-8). 모든 쓰기는 write 토큰 + **한 트랜잭션** 안에서
 * ① items 변경 ② 조달 이력 item_changes(changed_by = 사용자 이메일) ③ audit_logs(procurement.item.*, actor = 사용자 id) 를 함께 쓴다.
 * 동시 편집: 대상 행을 `FOR UPDATE` 로 잠근 뒤 화면이 읽은 version(updated_at)·상태와 비교하고, 하나라도 다르면 전체를 되돌리고
 * CONFLICT "이미 처리됨"(details.alreadyProcessed = id 목록)으로 거부한다 — 화면은 안내 후 목록을 새로 불러온다.
 * updated_at·product_group 은 트리거 items_before_write 가 채운다(여기서 쓰지 않는다).
 * 이력·감사의 before/after 는 DB 열 이름(snake_case)으로 바뀐 칸만 — 이관된 원본 이력과 같은 모양.
 */

export type ItemMutationContext = {
  handle: DbHandle;
  access: ProcurementAccess;
  meta: RequestMeta;
};
export type ItemMutationResult = { count: number; ids: number[] };

const t = procurementItems;

// ── 입력 ─────────────────────────────────────────────────────────────

const targetSchema = z.object({
  id: z.number().int().positive(),
  version: z.string().regex(/^\d+$/, '버전 형식이 아닙니다'),
});

const targetsSchema = z
  .array(targetSchema)
  .min(1, '품목을 선택하세요')
  .max(ITEM_BATCH_LIMIT, `한 번에 ${ITEM_BATCH_LIMIT}건까지 처리할 수 있습니다`)
  .refine(
    (list) => new Set(list.map((item) => item.id)).size === list.length,
    '같은 품목이 두 번 있습니다',
  );

export const itemTargetsSchema = z.object({ targets: targetsSchema });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null)
    .optional();

function isItemProduct(value: string): boolean {
  return (PROCUREMENT_ITEM_PRODUCTS as readonly string[]).includes(value);
}

const itemIdSchema = z
  .string()
  .trim()
  .min(1, '물품식별번호를 입력하세요')
  .max(50, '물품식별번호가 너무 깁니다');

export const itemPatchSchema = z
  .object({
    product: z
      .string()
      .refine(isItemProduct, '제품은 WAPPLES / D.AMO / iSIGN / 기타 중 하나입니다')
      .optional(),
    detailCategory: optionalText(100),
    manufacturer: optionalText(200),
    itemId: itemIdSchema.optional(),
    itemName: optionalText(300),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    '바꿀 값이 없습니다',
  );

export const editItemsSchema = z.object({ targets: targetsSchema, patch: itemPatchSchema });

export const addItemSchema = z.object({
  product: z.enum(PROCUREMENT_PRODUCTS, '제품을 선택하세요'),
  itemId: itemIdSchema,
  itemName: optionalText(300),
  manufacturer: optionalText(200),
  detailCategory: optionalText(100),
});

export type ItemTargetsInput = z.input<typeof itemTargetsSchema>;
export type EditItemsInput = z.input<typeof editItemsSchema>;
export type AddItemInput = z.input<typeof addItemSchema>;

// ── 이력·감사 ─────────────────────────────────────────────────────────

/** 이력·감사 스냅샷 키 (DB 열 이름) */
const SNAPSHOT_KEYS = {
  itemId: 'item_id',
  product: 'product',
  detailCategory: 'detail_category',
  manufacturer: 'manufacturer',
  itemName: 'item_name',
  status: 'status',
  reviewed: 'reviewed',
} as const;
type SnapshotField = keyof typeof SNAPSHOT_KEYS;
const SNAPSHOT_FIELDS = Object.keys(SNAPSHOT_KEYS) as SnapshotField[];

type ItemState = Pick<AdminItemRow, SnapshotField>;

function snapshot(row: ItemState, fields: readonly SnapshotField[] = SNAPSHOT_FIELDS) {
  return Object.fromEntries(fields.map((field) => [SNAPSHOT_KEYS[field], row[field]]));
}

/** 바뀐 칸만 before/after (없으면 null) */
function diff(before: ItemState, after: ItemState) {
  const changed = SNAPSHOT_FIELDS.filter((field) => before[field] !== after[field]);
  return changed.length
    ? { before: snapshot(before, changed), after: snapshot(after, changed) }
    : null;
}

type ChangeEntry = {
  action: ItemChangeAction;
  row: Pick<AdminItemRow, 'id' | 'itemId' | 'product'>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** 같은 트랜잭션에서 조달 이력 + 감사 로그 (D-8). 한 품목 = 이력 1행 + 감사 1행 */
async function record(tx: Tx, ctx: ItemMutationContext, entries: readonly ChangeEntry[]) {
  if (entries.length === 0) return;
  await tx.insert(procurementItemChanges).values(
    entries.map((entry) => ({
      itemPk: entry.row.id,
      action: entry.action,
      before: entry.before,
      after: entry.after,
      changedBy: ctx.access.email,
    })),
  );
  await tx.insert(auditLogs).values(
    entries.map((entry) =>
      toAuditRow({
        actor: { id: ctx.access.userId, label: ctx.access.email },
        action: AUDIT_PROCUREMENT_ITEM[entry.action],
        target: {
          type: 'procurement_item',
          id: String(entry.row.id),
          label: `${entry.row.itemId} · ${entry.row.product}`,
        },
        before: entry.before,
        after: entry.after,
        meta: ctx.meta,
      }),
    ),
  );
}

// ── 동시 편집 재검증 ─────────────────────────────────────────────────

/** 대상 행 잠금(FOR UPDATE) 후 version·상태 재검증. 하나라도 어긋나면 CONFLICT "이미 처리됨" */
async function lockFresh(
  tx: Tx,
  targets: readonly ItemTarget[],
  allowed: (row: AdminItemRow) => boolean,
): Promise<AdminItemRow[]> {
  const ids = targets.map((target) => target.id);
  const rows = await tx
    .select(ADMIN_ITEM_SELECTION)
    .from(t)
    .where(inArray(t.id, ids))
    .orderBy(t.id)
    .for('update');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const stale = targets.filter((target) => {
    const row = byId.get(target.id);
    return !row || row.version !== target.version || !allowed(row);
  });
  if (stale.length > 0) {
    throw new AppError(
      'CONFLICT',
      `${ITEM_ALREADY_PROCESSED} — 다른 사용자가 먼저 바꾼 품목이 ${stale.length}건 있습니다. 목록을 새로 불러옵니다.`,
      undefined,
      { alreadyProcessed: stale.map((target) => target.id) },
    );
  }
  // 화면 순서(targets) 그대로
  return targets.map((target) => byId.get(target.id)!);
}

const inReviewQueue = (row: AdminItemRow) =>
  row.status === 'pending' || (row.status === 'active' && !row.reviewed);

function assertWrite(ctx: ItemMutationContext) {
  assertProcurementAccess(ctx.access, 'write');
}

function result(rows: readonly { id: number }[]): ItemMutationResult {
  return { count: rows.length, ids: rows.map((row) => row.id) };
}

// ── 일일 신규 품목: 선택 추가·일괄 추가 ────────────────────────────────

/**
 * 검토 대기 품목을 등록한다 (status → active, reviewed → true). 이력·감사 행위:
 * 제품 미정(pending)에서 등록 = include, 이미 자동 등록된(active·미확인) 품목 확인 = review.
 * 제품이 '기타'(미정)인 품목은 제품을 먼저 골라야 한다(VALIDATION, 아무것도 바꾸지 않음).
 */
export async function includeReviewItems(
  ctx: ItemMutationContext,
  raw: ItemTargetsInput,
): Promise<ItemMutationResult> {
  assertWrite(ctx);
  const { targets } = itemTargetsSchema.parse(raw);
  return withTransaction(async (tx) => {
    const rows = await lockFresh(tx, targets, inReviewQueue);
    const undecided = rows.filter((row) => row.product === '기타');
    if (undecided.length > 0) {
      throw new AppError(
        'VALIDATION',
        `제품이 정해지지 않은 ${undecided.length}건은 제품을 먼저 골라야 추가할 수 있어요`,
        { product: ['WAPPLES / D.AMO / iSIGN 중 하나를 선택하세요'] },
        { undecided: undecided.map((row) => row.id) },
      );
    }
    await tx
      .update(t)
      .set({ status: 'active', reviewed: true })
      .where(
        inArray(
          t.id,
          rows.map((row) => row.id),
        ),
      );
    await record(
      tx,
      ctx,
      rows.map((row) => {
        const next = { ...row, status: 'active', reviewed: true };
        const changed = diff(row, next)!;
        return { action: row.status === 'pending' ? 'include' : 'review', row, ...changed };
      }),
    );
    return result(rows);
  }, ctx.handle);
}

// ── 휴지통으로 (일일 신규 품목·등록 품목 공통) ─────────────────────────

/** 휴지통으로 옮긴다 (status → excluded, reviewed → true — 매일 수집이 다시 올리지 않게). 행위 exclude */
export async function excludeItems(
  ctx: ItemMutationContext,
  raw: ItemTargetsInput,
): Promise<ItemMutationResult> {
  assertWrite(ctx);
  const { targets } = itemTargetsSchema.parse(raw);
  return withTransaction(async (tx) => {
    const rows = await lockFresh(tx, targets, (row) => row.status !== 'excluded');
    await tx
      .update(t)
      .set({ status: 'excluded', reviewed: true })
      .where(
        inArray(
          t.id,
          rows.map((row) => row.id),
        ),
      );
    await record(
      tx,
      ctx,
      rows.map((row) => ({
        action: 'exclude',
        row,
        ...diff(row, { ...row, status: 'excluded', reviewed: true })!,
      })),
    );
    return result(rows);
  }, ctx.handle);
}

// ── 휴지통에서 되살리기 ────────────────────────────────────────────────

/** 원래 자리로 — 제품이 정해졌으면 등록(active), 제품 미정('기타')이면 일일 신규 품목(pending). 행위 include */
export async function restoreItems(
  ctx: ItemMutationContext,
  raw: ItemTargetsInput,
): Promise<ItemMutationResult> {
  assertWrite(ctx);
  const { targets } = itemTargetsSchema.parse(raw);
  return withTransaction(async (tx) => {
    const rows = await lockFresh(tx, targets, (row) => row.status === 'excluded');
    const nextStatus = (row: AdminItemRow) => (row.product === '기타' ? 'pending' : 'active');
    for (const status of ['active', 'pending'] as const) {
      const ids = rows.filter((row) => nextStatus(row) === status).map((row) => row.id);
      if (ids.length) await tx.update(t).set({ status }).where(inArray(t.id, ids));
    }
    await record(
      tx,
      ctx,
      rows.map((row) => ({
        action: 'include',
        row,
        ...diff(row, { ...row, status: nextStatus(row) })!,
      })),
    );
    return result(rows);
  }, ctx.handle);
}

// ── 편집 (행 편집·일괄 변경·검토 카드 행 내 제품/세부분류) ──────────────

/** (물품식별번호, 제품) UNIQUE — 같은 조합이 다른 행(휴지통 포함)에 있으면 CONFLICT */
async function assertUniquePair(tx: Tx, itemId: string, product: string, exceptId?: number) {
  const [clash] = await tx
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(
      and(eq(t.itemId, itemId), eq(t.product, product), exceptId ? ne(t.id, exceptId) : undefined),
    )
    .limit(1);
  if (!clash) return;
  const where =
    clash.status === 'excluded'
      ? '휴지통에 있습니다 — 휴지통에서 되살리세요'
      : clash.status === 'pending'
        ? '일일 신규 품목에서 검토 대기 중입니다'
        : '이미 등록되어 있습니다';
  throw new AppError('CONFLICT', `${product} 물품식별번호 ${itemId} 는 ${where}`, {
    itemId: [`이미 ${product}에 있는 물품식별번호입니다`],
  });
}

function assertIsignCategory(product: string, detailCategory: string | null) {
  if (product === 'iSIGN' && detailCategory && !isIsignDetailCategory(detailCategory)) {
    throw new AppError('VALIDATION', 'iSIGN 세부분류는 목록에서 고르세요', {
      detailCategory: [
        'iSIGN 세부분류는 SSO·PKI·OTP·생체인증·PIN·간편인증·인증서중계·OS 로그온 중 하나입니다',
      ],
    });
  }
}

/**
 * 품목 편집. patch 에 있는 칸만 바꾼다(없는 칸은 그대로). 물품식별번호는 한 건 편집에서만 바꿀 수 있다.
 * 휴지통 품목은 편집하지 않는다(되살린 뒤). 실제로 바뀐 품목만 이력·감사(edit)를 남긴다 — 모두 그대로면 count 0.
 */
export async function editItems(
  ctx: ItemMutationContext,
  raw: EditItemsInput,
): Promise<ItemMutationResult> {
  assertWrite(ctx);
  const { targets, patch } = editItemsSchema.parse(raw);
  if (patch.itemId !== undefined && targets.length > 1) {
    throw new AppError('VALIDATION', '물품식별번호는 한 건씩 바꿀 수 있습니다');
  }
  return withTransaction(async (tx) => {
    const rows = await lockFresh(tx, targets, (row) => row.status !== 'excluded');
    const changed: ChangeEntry[] = [];
    for (const row of rows) {
      const next: AdminItemRow = {
        ...row,
        ...(patch.product !== undefined && { product: patch.product }),
        ...(patch.detailCategory !== undefined && { detailCategory: patch.detailCategory }),
        ...(patch.manufacturer !== undefined && { manufacturer: patch.manufacturer }),
        ...(patch.itemId !== undefined && { itemId: patch.itemId }),
        ...(patch.itemName !== undefined && { itemName: patch.itemName }),
      };
      const delta = diff(row, next);
      if (!delta) continue;
      // 세부분류를 새로 정할 때만 iSIGN 목록 검사 (제품만 바꾸는 일괄 변경은 기존 세부분류를 그대로 둔다)
      if (patch.detailCategory !== undefined)
        assertIsignCategory(next.product, next.detailCategory);
      if (next.itemId !== row.itemId || next.product !== row.product) {
        await assertUniquePair(tx, next.itemId, next.product, row.id);
      }
      const updated = firstRow(
        await tx
          .update(t)
          .set({
            product: next.product,
            detailCategory: next.detailCategory,
            manufacturer: next.manufacturer,
            itemId: next.itemId,
            itemName: next.itemName,
          })
          .where(eq(t.id, row.id))
          .returning({ id: t.id, itemId: t.itemId, product: t.product }),
        'items update',
      );
      changed.push({ action: 'edit', row: updated, ...delta });
    }
    await record(tx, ctx, changed);
    return { count: changed.length, ids: changed.map((entry) => entry.row.id) };
  }, ctx.handle);
}

// ── 단건 직접 추가 ────────────────────────────────────────────────────

/** 직접 추가 (source = manual, 등록 = active·reviewed, 등록일자 = 오늘 KST). 행위 add */
export async function addItem(
  ctx: ItemMutationContext,
  raw: AddItemInput,
): Promise<ItemMutationResult> {
  assertWrite(ctx);
  const input = addItemSchema.parse(raw);
  assertIsignCategory(input.product, input.detailCategory ?? null);
  return withTransaction(async (tx) => {
    await assertUniquePair(tx, input.itemId, input.product);
    const created = firstRow(
      await tx
        .insert(t)
        .values({
          itemId: input.itemId,
          product: input.product,
          detailCategory: input.detailCategory ?? null,
          manufacturer: input.manufacturer ?? null,
          itemName: input.itemName ?? null,
          registeredOn: sql`(now() at time zone 'Asia/Seoul')::date`,
          status: 'active',
          reviewed: true,
          source: 'manual',
        })
        .returning(ADMIN_ITEM_SELECTION),
      'items insert',
    );
    await record(tx, ctx, [
      {
        action: 'add',
        row: created,
        before: null,
        after: {
          ...snapshot(created),
          source: created.source,
          registered_on: created.registeredOn,
        },
      },
    ]);
    return result([created]);
  }, ctx.handle);
}
