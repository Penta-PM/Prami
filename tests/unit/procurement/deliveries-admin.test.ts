// @vitest-environment node
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import {
  auditLogs,
  procurementDeliveries,
  procurementDeliveryChanges,
  procurementItems,
  procurementVDeliveries,
  type NewProcurementDelivery,
} from '@/db/schema';
import {
  AUDIT_DELIVERY_EXCLUDE,
  AUDIT_DELIVERY_RESTORE,
  AUDIT_DELIVERY_UPDATE,
  DELIVERY_FIELD_KEYS,
  deliveryFormText,
  type DeliveryValues,
} from '@/features/procurement/admin/deliveries/fields';
import { AppError } from '@/lib/result';
import { procurementAccessForTests } from '@/server/procurement/access-token';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-6 실적 관리 — 조회(관리 목록·휴지통·이력)와 쓰기(편집·휴지통·되살리기). PGlite, 합성 데이터만(가짜 요구번호·업체·기관).
 * D-8: 쓰기마다 delivery_changes(changed_by = 이메일) + audit_logs(actor = 사용자 id) 를 같은 트랜잭션에 — 감사 기록이 실패하면 전부 롤백.
 * 동시 편집: 연 시점 값과 현재 값이 다르거나 이미 처리된 행이면 CONFLICT(reason 'stale', "이미 처리됨").
 */
const audit = vi.hoisted(() => ({ failNext: false }));

vi.mock('@/server/audit/log', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/audit/log')>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (audit.failNext) {
        audit.failNext = false;
        throw new Error('감사 기록 실패(테스트)');
      }
      return original.writeAudit(...args);
    },
  };
});

const { getDeliveryAdminFacets, getDeliveryAdminRows, getDeliveryDetail, getDeliveryHistory } =
  await import('@/server/procurement/deliveries');
const { excludeDelivery, restoreDelivery, updateDelivery } =
  await import('@/server/procurement/delivery-mutations');

let handle: DbHandle;
let adminId: string;
const ADMIN_EMAIL = 'admin@pentasecurity.com';
const META = { ip: null, userAgent: 'vitest' };

function writeAccess() {
  return procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'write');
}

function ctx() {
  return { handle, access: writeAccess(), meta: META };
}

function delivery(values: Partial<NewProcurementDelivery> & { dlvrReqNo: string; itemId: string }) {
  return {
    vendor: '가상상사',
    demandOrg: '가상기관',
    dlvrReqDate: '2026-03-01',
    unitPrice: 1_000_000,
    quantity: '2',
    amount: 2_000_000,
    ...values,
  } satisfies NewProcurementDelivery;
}

async function insertDelivery(
  values: Partial<NewProcurementDelivery> & { dlvrReqNo: string; itemId: string },
) {
  const [row] = await handle.db.insert(procurementDeliveries).values(delivery(values)).returning();
  return row!;
}

async function detailOf(id: number) {
  const detail = await getDeliveryDetail(writeAccess(), handle.db, id);
  if (!detail) throw new Error('detail 없음');
  return detail;
}

/** 폼 값 = 지금 값 그대로(문자열) + 바꿀 칸 */
function formOf(values: DeliveryValues, patch: Partial<Record<keyof DeliveryValues, string>> = {}) {
  const form = Object.fromEntries(
    DELIVERY_FIELD_KEYS.map((key) => [key, deliveryFormText(values[key])]),
  ) as Record<keyof DeliveryValues, string>;
  return { ...form, ...patch };
}

async function counts() {
  return {
    changes: await handle.db.$count(procurementDeliveryChanges),
    audits: await handle.db.$count(auditLogs),
  };
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  return promise.then(
    () => {
      throw new Error('거부되지 않았습니다');
    },
    (error: unknown) => error as AppError,
  );
}

beforeAll(async () => {
  handle = await createTestDb();
  adminId = (await insertUser(handle, { email: ADMIN_EMAIL, role: 'ADMIN' })).id;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  audit.failNext = false;
  await handle.db.execute(
    sql`truncate procurement.delivery_changes, procurement.deliveries, procurement.items, audit_logs restart identity cascade`,
  );
});

describe('관리 목록 (getDeliveryAdminRows)', () => {
  it('납품요구 = 제외 안 된 원 행(변경차수마다), 휴지통 = excluded, 휴지통 건수·제품(등록 물품)·미등록', async () => {
    await handle.db.insert(procurementItems).values([
      { itemId: 'T-100', product: 'WAPPLES', status: 'active' },
      { itemId: 'T-200', product: 'D.AMO', status: 'excluded' },
    ]);
    await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-100', changeOrd: '00' });
    await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-100', changeOrd: '01' });
    await insertDelivery({ dlvrReqNo: 'R-2', itemId: 'T-200', dlvrReqDate: '2026-04-01' });
    await insertDelivery({ dlvrReqNo: 'R-3', itemId: 'T-300', excluded: true });

    const active = await getDeliveryAdminRows(writeAccess(), handle.db, {
      view: 'active',
      page: 1,
    });
    expect(active.total).toBe(3);
    expect(active.trashCount).toBe(1);
    // 기본 정렬: 납품요구일자 최신순 → 요구번호 → 차수
    expect(active.rows.map((row) => `${row.dlvrReqNo}-${row.changeOrd}:${row.product}`)).toEqual([
      'R-2-00:null',
      'R-1-00:WAPPLES',
      'R-1-01:WAPPLES',
    ]);
    expect(active.rows[1]).toMatchObject({ unitPrice: 1_000_000, amount: 2_000_000 });

    const trash = await getDeliveryAdminRows(writeAccess(), handle.db, { view: 'trash', page: 1 });
    expect(trash.rows.map((row) => row.dlvrReqNo)).toEqual(['R-3']);
    expect(trash.rows[0]).toMatchObject({ excluded: true, excludedAt: null, excludedBy: null });

    const facets = await getDeliveryAdminFacets(writeAccess(), handle.db, 'active');
    expect(facets).toEqual({ products: ['WAPPLES', '미등록'], vendors: ['가상상사'] });
  });

  it("수요기관 '같음'(eq)은 일치(ASCII 대소문자 무시), '포함'(has)은 부분 일치 — 다른 서버 표와 같은 규칙", async () => {
    await insertDelivery({ dlvrReqNo: 'R-A', itemId: 'T-1', demandOrg: 'Test 기관' });
    await insertDelivery({ dlvrReqNo: 'R-B', itemId: 'T-1', demandOrg: 'Test 기관 지사' });
    await insertDelivery({ dlvrReqNo: 'R-C', itemId: 'T-1', demandOrg: null });
    const names = async (op: 'has' | 'eq', value: string) =>
      (
        await getDeliveryAdminRows(writeAccess(), handle.db, {
          view: 'active',
          page: 1,
          demandOrg: { op, value },
          sort: { id: 'demandOrg', dir: 'asc' },
        })
      ).rows.map((row) => row.dlvrReqNo);
    expect(await names('has', 'test 기관')).toEqual(['R-A', 'R-B']);
    expect(await names('eq', 'test 기관')).toEqual(['R-A']);
    expect(await names('eq', ' TEST 기관 ')).toEqual(['R-A']);
    expect(await names('eq', 'Test')).toEqual([]);
  });

  it('필터(제품·미등록·업체·수요기관·기간·검색)·정렬·페이지네이션은 SQL', async () => {
    await handle.db.insert(procurementItems).values([
      { itemId: 'T-1', product: 'WAPPLES', status: 'active' },
      { itemId: 'T-2', product: 'iSIGN', status: 'active' },
    ]);
    for (let i = 0; i < 5; i++)
      await insertDelivery({
        dlvrReqNo: `R-W${i}`,
        itemId: 'T-1',
        vendor: '가상상사',
        amount: (i + 1) * 1_000_000,
        dlvrReqDate: `2026-0${i + 1}-15`,
      });
    await insertDelivery({
      dlvrReqNo: 'R-I',
      itemId: 'T-2',
      vendor: '다른상사',
      demandOrg: '시험청',
    });
    await insertDelivery({ dlvrReqNo: 'R-X', itemId: 'T-9', businessName: '가상 구축 사업' });

    const list = (filter: Parameters<typeof getDeliveryAdminRows>[2]) =>
      getDeliveryAdminRows(writeAccess(), handle.db, filter);

    expect((await list({ view: 'active', page: 1, products: ['iSIGN'] })).rows).toHaveLength(1);
    expect(
      (await list({ view: 'active', page: 1, products: ['미등록'] })).rows.map((r) => r.dlvrReqNo),
    ).toEqual(['R-X']);
    expect((await list({ view: 'active', page: 1, vendors: ['다른상사'] })).total).toBe(1);
    expect(
      (await list({ view: 'active', page: 1, demandOrg: { op: 'has', value: '시험' } })).total,
    ).toBe(1);
    expect(
      (await list({ view: 'active', page: 1, dateFrom: '2026-02-01', dateTo: '2026-03-31' })).total,
    ).toBe(4); // R-W1(02-15)·R-W2(03-15)·R-I·R-X(03-01)
    expect(
      (await list({ view: 'active', page: 1, q: '구축' })).rows.map((r) => r.dlvrReqNo),
    ).toEqual(['R-X']);
    // LIKE 특수문자는 문자 그대로
    expect((await list({ view: 'active', page: 1, q: '%' })).total).toBe(0);

    const sorted = await list({ view: 'active', page: 1, sort: { id: 'amount', dir: 'desc' } });
    expect(sorted.rows[0]?.dlvrReqNo).toBe('R-W4');

    const paged = await getDeliveryAdminRows(
      writeAccess(),
      handle.db,
      { view: 'active', page: 2 },
      3,
    );
    expect(paged).toMatchObject({ total: 7, page: 2, pageCount: 3, pageSize: 3 });
    expect(paged.rows).toHaveLength(3);
  });

  it('read 토큰으로는 관리 목록·이력을 읽을 수 없다 (procurement.write 전용)', async () => {
    const read = procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'read');
    await expect(
      getDeliveryAdminRows(read, handle.db, { view: 'active', page: 1 }),
    ).rejects.toThrow('write 범위');
    await expect(getDeliveryHistory(read, handle.db, 1)).rejects.toThrow('write 범위');
  });
});

describe('편집 저장 (updateDelivery)', () => {
  it('바뀐 칸만 delivery_changes(이메일)·audit(사용자 id) 에 같이 기록한다', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const before = await detailOf(row.id);
    const result = await updateDelivery(ctx(), {
      id: row.id,
      values: formOf(before.values, {
        amount: '3,500,000',
        quantity: '3.5',
        demandOrg: '  새기관 ',
      }),
      expected: before.values,
    });
    expect(result).toEqual({ id: row.id, changed: 3 });

    const [saved] = await handle.db
      .select()
      .from(procurementDeliveries)
      .where(eq(procurementDeliveries.id, row.id));
    expect(saved).toMatchObject({ amount: 3_500_000, quantity: '3.5', demandOrg: '새기관' });

    const changes = await handle.db.select().from(procurementDeliveryChanges);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      deliveryId: row.id,
      changedBy: ADMIN_EMAIL,
      before: { amount: 2_000_000, quantity: 2, demand_org: '가상기관' },
      after: { amount: 3_500_000, quantity: 3.5, demand_org: '새기관' },
    });
    const audits = await auditByAction(handle, AUDIT_DELIVERY_UPDATE);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: adminId,
      actorLabel: ADMIN_EMAIL,
      targetType: 'procurement.delivery',
      targetId: String(row.id),
      targetLabel: 'R-1-00 · T-1',
      result: 'success',
      after: { amount: 3_500_000, quantity: 3.5, demand_org: '새기관' },
    });
  });

  it('바뀐 칸이 없으면(쉼표·공백·수량 표기만 다름) 아무것도 쓰지 않는다', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const before = await detailOf(row.id);
    const result = await updateDelivery(ctx(), {
      id: row.id,
      values: formOf(before.values, {
        amount: '2,000,000',
        quantity: '2.00',
        vendor: ' 가상상사 ',
      }),
      expected: before.values,
    });
    expect(result.changed).toBe(0);
    expect(await counts()).toEqual({ changes: 0, audits: 0 });
  });

  it('동시 편집: 연 뒤 다른 사람이 바꿨으면 "이미 처리됨"(CONFLICT stale) — 덮어쓰지 않고 기록도 없다', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const opened = await detailOf(row.id);
    // 다른 사람이 먼저 저장
    await updateDelivery(ctx(), {
      id: row.id,
      values: formOf(opened.values, { vendor: '먼저상사' }),
      expected: opened.values,
    });
    const error = await caught(
      updateDelivery(ctx(), {
        id: row.id,
        values: formOf(opened.values, { amount: '9' }),
        expected: opened.values,
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toContain('이미 처리됨');
    expect(error.details).toEqual({ reason: 'stale' });
    const [saved] = await handle.db.select().from(procurementDeliveries);
    expect(saved).toMatchObject({ vendor: '먼저상사', amount: 2_000_000 });
    expect(await counts()).toEqual({ changes: 1, audits: 1 });
  });

  it('휴지통으로 옮겨진 행은 편집 저장도 "이미 처리됨"', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const opened = await detailOf(row.id);
    await excludeDelivery(ctx(), { id: row.id });
    const error = await caught(
      updateDelivery(ctx(), {
        id: row.id,
        values: formOf(opened.values, { amount: '9' }),
        expected: opened.values,
      }),
    );
    expect(error.details).toEqual({ reason: 'stale' });
  });

  it('같은 (요구번호, 물품, 차수)로 바꾸면 CONFLICT duplicate, 롤백', async () => {
    await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1', changeOrd: '00' });
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1', changeOrd: '01' });
    const opened = await detailOf(row.id);
    const error = await caught(
      updateDelivery(ctx(), {
        id: row.id,
        values: formOf(opened.values, { changeOrd: '00' }),
        expected: opened.values,
      }),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual({ reason: 'duplicate' });
    expect(await counts()).toEqual({ changes: 0, audits: 0 });
  });

  it('입력 검증: 필수 칸 비움·숫자 아님·날짜 형식 → VALIDATION(fieldErrors), 기록 없음', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const opened = await detailOf(row.id);
    const error = await caught(
      updateDelivery(ctx(), {
        id: row.id,
        values: formOf(opened.values, {
          itemId: ' ',
          amount: '12만',
          unitPrice: '1.5',
          dueDate: '2026-02-30',
        }),
        expected: opened.values,
      }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      'amount',
      'dueDate',
      'itemId',
      'unitPrice',
    ]);
    expect(await counts()).toEqual({ changes: 0, audits: 0 });
  });

  it('감사 기록이 실패하면 변경·이력까지 롤백한다 (같은 트랜잭션)', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const opened = await detailOf(row.id);
    audit.failNext = true;
    await expect(
      updateDelivery(ctx(), {
        id: row.id,
        values: formOf(opened.values, { amount: '7' }),
        expected: opened.values,
      }),
    ).rejects.toThrow('감사 기록 실패');
    const [saved] = await handle.db.select().from(procurementDeliveries);
    expect(saved?.amount).toBe(2_000_000);
    expect(await counts()).toEqual({ changes: 0, audits: 0 });
  });

  it('read 토큰으로는 쓸 수 없다', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const opened = await detailOf(row.id);
    const read = procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'read');
    await expect(
      updateDelivery(
        { handle, access: read, meta: META },
        { id: row.id, values: formOf(opened.values), expected: opened.values },
      ),
    ).rejects.toThrow('write 범위');
    await expect(
      excludeDelivery({ handle, access: read, meta: META }, { id: row.id }),
    ).rejects.toThrow('write 범위');
  });
});

describe('휴지통 (excludeDelivery / restoreDelivery)', () => {
  it('휴지통으로 → 통계 뷰에서 빠지고 이력·감사 → 되살리기 → 다시 보인다', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const inView = () => handle.db.$count(procurementVDeliveries);
    expect(await inView()).toBe(1);

    expect(await excludeDelivery(ctx(), { id: row.id })).toEqual({ id: row.id, excluded: true });
    expect(await inView()).toBe(0);
    const trash = await getDeliveryAdminRows(writeAccess(), handle.db, { view: 'trash', page: 1 });
    expect(trash.rows[0]).toMatchObject({ id: row.id, excludedBy: ADMIN_EMAIL });
    expect(trash.rows[0]?.excludedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(await restoreDelivery(ctx(), { id: row.id })).toEqual({ id: row.id, excluded: false });
    expect(await inView()).toBe(1);

    const changes = await handle.db
      .select()
      .from(procurementDeliveryChanges)
      .orderBy(asc(procurementDeliveryChanges.id));
    expect(changes.map((change) => [change.before, change.after, change.changedBy])).toEqual([
      [{ excluded: false }, { excluded: true }, ADMIN_EMAIL],
      [{ excluded: true }, { excluded: false }, ADMIN_EMAIL],
    ]);
    expect(await auditByAction(handle, AUDIT_DELIVERY_EXCLUDE)).toHaveLength(1);
    const [restored] = await auditByAction(handle, AUDIT_DELIVERY_RESTORE);
    expect(restored).toMatchObject({ actorUserId: adminId, targetId: String(row.id) });
  });

  it('이미 휴지통에 있는 행을 다시 옮기거나, 이미 되살린 행을 되살리면 "이미 처리됨"', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    await excludeDelivery(ctx(), { id: row.id });
    expect((await caught(excludeDelivery(ctx(), { id: row.id }))).details).toEqual({
      reason: 'stale',
    });
    await restoreDelivery(ctx(), { id: row.id });
    expect((await caught(restoreDelivery(ctx(), { id: row.id }))).details).toEqual({
      reason: 'stale',
    });
    expect((await caught(excludeDelivery(ctx(), { id: 999_999 }))).code).toBe('CONFLICT');
    expect(await counts()).toEqual({ changes: 2, audits: 2 });
  });

  it('휴지통 표: 행마다 자기 마지막 삭제 기록(시각·사람), 기본 정렬 = 삭제 최신순', async () => {
    const first = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    const second = await insertDelivery({ dlvrReqNo: 'R-2', itemId: 'T-2' });
    const third = await insertDelivery({ dlvrReqNo: 'R-3', itemId: 'T-3' });
    const other = procurementAccessForTests(
      { id: adminId, email: 'other@pentasecurity.com' },
      'write',
    );
    await excludeDelivery(ctx(), { id: second.id });
    await excludeDelivery({ handle, access: other, meta: META }, { id: third.id });
    // 되살렸다 다시 지운 행 — 마지막 기록이 기준
    await excludeDelivery({ handle, access: other, meta: META }, { id: first.id });
    await restoreDelivery(ctx(), { id: first.id });
    await excludeDelivery(ctx(), { id: first.id });

    const trash = await getDeliveryAdminRows(writeAccess(), handle.db, { view: 'trash', page: 1 });
    expect(trash.rows.map((row) => [row.dlvrReqNo, row.excludedBy])).toEqual([
      ['R-1', ADMIN_EMAIL],
      ['R-3', 'other@pentasecurity.com'],
      ['R-2', ADMIN_EMAIL],
    ]);
    const oldestFirst = await getDeliveryAdminRows(writeAccess(), handle.db, {
      view: 'trash',
      page: 1,
      sort: { id: 'excludedAt', dir: 'asc' },
    });
    expect(oldestFirst.rows.map((row) => row.dlvrReqNo)).toEqual(['R-2', 'R-3', 'R-1']);
  });

  it('감사 실패 시 휴지통 이동도 롤백', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    audit.failNext = true;
    await expect(excludeDelivery(ctx(), { id: row.id })).rejects.toThrow('감사 기록 실패');
    const [saved] = await handle.db.select().from(procurementDeliveries);
    expect(saved?.excluded).toBe(false);
    expect(await counts()).toEqual({ changes: 0, audits: 0 });
  });
});

describe('변경 이력 (최근 10건)', () => {
  it('편집 화면은 최신순 최근 10건만, 모든 필드 값을 함께 준다', async () => {
    const row = await insertDelivery({ dlvrReqNo: 'R-1', itemId: 'T-1' });
    for (let i = 1; i <= 12; i++) {
      const opened = await detailOf(row.id);
      await updateDelivery(ctx(), {
        id: row.id,
        values: formOf(opened.values, { amount: String(i) }),
        expected: opened.values,
      });
    }
    const detail = await detailOf(row.id);
    expect(Object.keys(detail.values)).toEqual(DELIVERY_FIELD_KEYS);
    expect(detail.history).toHaveLength(10);
    expect(detail.history.map((entry) => entry.after?.amount)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(detail.history[0]?.changedBy).toBe(ADMIN_EMAIL);
    expect(await handle.db.$count(procurementDeliveryChanges)).toBe(12);
  });
});
