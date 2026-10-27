import 'server-only';

import { eq } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { procurementDeliveries, procurementDeliveryChanges } from '@/db/schema/procurement';
import { withTransaction, type Tx } from '@/db/tx';
import {
  AUDIT_DELIVERY_EXCLUDE,
  AUDIT_DELIVERY_RESTORE,
  AUDIT_DELIVERY_UPDATE,
  canonicalDeliveryValue,
  DELIVERY_DUPLICATE_MESSAGE,
  DELIVERY_EDIT_FIELDS,
  DELIVERY_STALE_MESSAGE,
  deliveryIdInputSchema,
  deliveryUpdateInputSchema,
  EXCLUDED_COLUMN,
  parseDeliveryFieldValue,
  type DeliveryConflictReason,
  type DeliveryField,
  type DeliveryIdInput,
  type DeliveryUpdateInput,
} from '@/features/procurement/admin/deliveries/fields';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditEntry, type RequestMeta } from '@/server/audit/log';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { DELIVERY_EDIT_SELECTION } from './deliveries';

/**
 * 조달 관리 · 실적 관리 쓰기 (조달이 통합 UI-6, D-8). 권한은 호출자(서버 액션)가 requireProcurementAccess('write') 로 얻은 토큰으로 증명하고,
 * 여기서는 한 트랜잭션 안에서 ① 현재 값 잠금·재검증 ② deliveries 변경 ③ delivery_changes(바뀐 칸만, changed_by = 사용자 이메일)
 * ④ audit_logs(procurement.delivery.update|exclude|restore, actor = 사용자 id) 를 함께 기록한다 — 하나라도 실패하면 전부 롤백.
 *
 * 동시 편집: 행을 `select … for update` 로 잠근 뒤 화면이 읽은 값(expected)·상태(excluded)와 다르면 CONFLICT(details.reason = 'stale',
 * "이미 처리됨") — 화면은 안내 후 새로 고친다.
 */
export type DeliveryMutationContext = {
  handle: DbHandle;
  access: ProcurementAccess;
  meta: RequestMeta;
};

export type DeliveryUpdateResult = { id: number; changed: number };
export type DeliveryExcludeResult = { id: number; excluded: boolean };

const d = procurementDeliveries;
const c = procurementDeliveryChanges;

export const AUDIT_TARGET_DELIVERY = 'procurement.delivery';

function conflict(reason: DeliveryConflictReason): AppError {
  return new AppError(
    'CONFLICT',
    reason === 'stale' ? DELIVERY_STALE_MESSAGE : DELIVERY_DUPLICATE_MESSAGE,
    undefined,
    { reason },
  );
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const causeCode = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === '23505' || causeCode === '23505';
}

function target(row: { id: number; dlvrReqNo: string; changeOrd: string; itemId: string }) {
  return {
    type: AUDIT_TARGET_DELIVERY,
    id: String(row.id),
    label: `${row.dlvrReqNo}-${row.changeOrd} · ${row.itemId}`,
  };
}

function actorOf(access: ProcurementAccess): AuditEntry['actor'] {
  return { id: access.userId, label: access.email };
}

/** 이력 JSON 값 — 숫자 칸은 number(수량 numeric 문자열도 number), 나머지는 문자열, 빈 값 null */
function historyValue(field: DeliveryField, value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'int' || field.type === 'num') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : String(value);
  }
  return String(value);
}

/** 저장 값 (numeric 열 quantity 는 문자열로 넘긴다) */
function dbValue(field: DeliveryField, value: string | number | null): string | number | null {
  if (value === null) return null;
  return field.type === 'num' ? String(value) : value;
}

async function lockRow(tx: Tx, id: number) {
  const [row] = await tx
    .select({ id: d.id, excluded: d.excluded, ...DELIVERY_EDIT_SELECTION })
    .from(d)
    .where(eq(d.id, id))
    .for('update');
  return row;
}

/** 편집 저장 — 바뀐 칸만 기록. 바뀐 칸이 없으면 아무것도 쓰지 않는다(changed 0) */
export async function updateDelivery(
  ctx: DeliveryMutationContext,
  raw: DeliveryUpdateInput,
): Promise<DeliveryUpdateResult> {
  assertProcurementAccess(ctx.access, 'write');
  const input = deliveryUpdateInputSchema.parse(raw);

  const next: Record<string, string | number | null> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const field of DELIVERY_EDIT_FIELDS) {
    const parsed = parseDeliveryFieldValue(field, input.values[field.key]);
    if (parsed.ok) next[field.key] = parsed.value;
    else fieldErrors[field.key] = [parsed.message];
  }
  if (Object.keys(fieldErrors).length > 0)
    throw new AppError('VALIDATION', '입력값을 확인하세요', fieldErrors);

  try {
    return await withTransaction(async (tx) => {
      const current = await lockRow(tx, input.id);
      if (!current || current.excluded) throw conflict('stale');
      // 동시 편집 재검증: 편집을 연 뒤 다른 사람이 바꾼 칸이 있으면 덮어쓰지 않는다
      for (const field of DELIVERY_EDIT_FIELDS) {
        if (
          canonicalDeliveryValue(field.type, current[field.key]) !==
          canonicalDeliveryValue(field.type, input.expected[field.key])
        )
          throw conflict('stale');
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const set: Record<string, string | number | null> = {};
      for (const field of DELIVERY_EDIT_FIELDS) {
        const value = next[field.key] ?? null;
        if (
          canonicalDeliveryValue(field.type, value) ===
          canonicalDeliveryValue(field.type, current[field.key])
        )
          continue;
        before[field.column] = historyValue(field, current[field.key]);
        after[field.column] = historyValue(field, value);
        set[field.key] = dbValue(field, value);
      }
      const changed = Object.keys(set).length;
      if (changed === 0) return { id: current.id, changed: 0 };

      await tx.update(d).set(set).where(eq(d.id, current.id));
      await tx.insert(c).values({
        deliveryId: current.id,
        before,
        after,
        changedBy: ctx.access.email,
      });
      await writeAudit(tx, {
        actor: actorOf(ctx.access),
        action: AUDIT_DELIVERY_UPDATE,
        target: target({ ...current, ...(set as Partial<typeof current>) }),
        before,
        after,
        meta: ctx.meta,
      });
      return { id: current.id, changed };
    }, ctx.handle);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('duplicate');
    throw error;
  }
}

async function setExcluded(
  ctx: DeliveryMutationContext,
  raw: DeliveryIdInput,
  excluded: boolean,
): Promise<DeliveryExcludeResult> {
  assertProcurementAccess(ctx.access, 'write');
  const { id } = deliveryIdInputSchema.parse(raw);
  return withTransaction(async (tx) => {
    const current = await lockRow(tx, id);
    // 이미 휴지통에 있는(또는 이미 되살린) 행 — 다른 사람이 먼저 처리했다
    if (!current || current.excluded === excluded) throw conflict('stale');
    await tx.update(d).set({ excluded }).where(eq(d.id, id));
    const before = { [EXCLUDED_COLUMN]: !excluded };
    const after = { [EXCLUDED_COLUMN]: excluded };
    await tx.insert(c).values({ deliveryId: id, before, after, changedBy: ctx.access.email });
    await writeAudit(tx, {
      actor: actorOf(ctx.access),
      action: excluded ? AUDIT_DELIVERY_EXCLUDE : AUDIT_DELIVERY_RESTORE,
      target: target(current),
      before,
      after,
      meta: ctx.meta,
    });
    return { id, excluded };
  }, ctx.handle);
}

/** 휴지통으로 (excluded = true) — 통계(v_deliveries)에서 빠진다 */
export function excludeDelivery(
  ctx: DeliveryMutationContext,
  raw: DeliveryIdInput,
): Promise<DeliveryExcludeResult> {
  return setExcluded(ctx, raw, true);
}

/** 휴지통에서 되살리기 (excluded = false) */
export function restoreDelivery(
  ctx: DeliveryMutationContext,
  raw: DeliveryIdInput,
): Promise<DeliveryExcludeResult> {
  return setExcluded(ctx, raw, false);
}
