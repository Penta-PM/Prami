// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, procurementDeliveries, procurementDeliveryChanges } from '@/db/schema';
import {
  AUDIT_DELIVERY_EXCLUDE,
  AUDIT_DELIVERY_RESTORE,
  AUDIT_DELIVERY_UPDATE,
  DELIVERY_FIELD_KEYS,
  deliveryFormText,
} from '@/features/procurement/admin/deliveries/fields';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-6 실적 관리 Server Actions — 실제 세션 가드 경로(runAction → requirePermission, requireProcurementAccess('write')).
 * USER: 조회·쓰기 모두 FORBIDDEN 봉투 + 감사 denied(행위 키) + deliveries·이력 무변경. 비로그인: UNAUTHENTICATED.
 * ADMIN: 성공 + 이력(changed_by = 이메일) + 감사(actor = 사용자 id).
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: '198.51.100.9', userAgent: 'vitest' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('@/features/procurement/admin/deliveries/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
let deliveryId: number;

async function snapshot() {
  const db = state.handle!.db;
  return {
    deliveries: await db.select().from(procurementDeliveries),
    changes: await db.$count(procurementDeliveryChanges),
  };
}

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const [row] = await state.handle.db
    .insert(procurementDeliveries)
    .values({ dlvrReqNo: 'R-1', itemId: 'T-1', vendor: '가상상사', amount: 1_000_000 })
    .returning();
  deliveryId = row!.id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = undefined;
});

describe('USER 는 실적 관리 조회·쓰기 거부 (procurement.write = ADMIN)', () => {
  it('편집 열기·편집·휴지통·되살리기 모두 FORBIDDEN + 감사 denied + 무변경', async () => {
    state.sessionUserId = userId;
    const before = await snapshot();
    const values = Object.fromEntries(DELIVERY_FIELD_KEYS.map((key) => [key, null]));

    const results = [
      await actions.getDeliveryDetailAction({ id: deliveryId }),
      await actions.updateDeliveryAction({
        id: deliveryId,
        values: { ...values, dlvrReqNo: 'R-1', changeOrd: '00', itemId: 'T-1' },
        expected: values,
      } as Parameters<typeof actions.updateDeliveryAction>[0]),
      await actions.excludeDeliveryAction({ id: deliveryId }),
      await actions.restoreDeliveryAction({ id: deliveryId }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
      expect('data' in result).toBe(false);
    }
    expect(await snapshot()).toEqual(before);

    const denied = async (action: string) =>
      (await auditByAction(state.handle!, action)).filter(
        (row) => row.result === 'denied' && row.actorUserId === userId,
      );
    expect(await denied('procurement.write')).toHaveLength(1);
    expect(await denied(AUDIT_DELIVERY_UPDATE)).toHaveLength(1);
    expect(await denied(AUDIT_DELIVERY_EXCLUDE)).toHaveLength(1);
    expect(await denied(AUDIT_DELIVERY_RESTORE)).toHaveLength(1);
  });

  it('비로그인은 UNAUTHENTICATED', async () => {
    const result = await actions.excludeDeliveryAction({ id: deliveryId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('ADMIN', () => {
  it('상세 → 편집 저장 → 휴지통 → 되살리기, 이력·감사가 남는다', async () => {
    state.sessionUserId = adminId;
    const detail = await actions.getDeliveryDetailAction({ id: deliveryId });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    const form = Object.fromEntries(
      DELIVERY_FIELD_KEYS.map((key) => [key, deliveryFormText(detail.data.values[key])]),
    ) as Record<(typeof DELIVERY_FIELD_KEYS)[number], string>;
    const saved = await actions.updateDeliveryAction({
      id: deliveryId,
      values: { ...form, amount: '1,200,000' },
      expected: detail.data.values,
    });
    expect(saved).toEqual({ ok: true, data: { id: deliveryId, changed: 1 } });

    // 같은(이제 낡은) expected 로 다시 저장 → 이미 처리됨
    const stale = await actions.updateDeliveryAction({
      id: deliveryId,
      values: { ...form, amount: '1,300,000' },
      expected: detail.data.values,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('CONFLICT');
      expect(stale.error.details).toEqual({ reason: 'stale' });
      expect(stale.error.message).toContain('이미 처리됨');
    }

    expect((await actions.excludeDeliveryAction({ id: deliveryId })).ok).toBe(true);
    expect(
      (await state.handle!.db.select().from(procurementDeliveries)).map((row) => row.excluded),
    ).toEqual([true]);
    expect((await actions.restoreDeliveryAction({ id: deliveryId })).ok).toBe(true);

    const success = async (action: string) =>
      (await auditByAction(state.handle!, action)).filter(
        (row) => row.result === 'success' && row.actorUserId === adminId,
      );
    expect(await success(AUDIT_DELIVERY_UPDATE)).toHaveLength(1);
    expect(await success(AUDIT_DELIVERY_EXCLUDE)).toHaveLength(1);
    expect(await success(AUDIT_DELIVERY_RESTORE)).toHaveLength(1);
    const changes = await state.handle!.db.select().from(procurementDeliveryChanges);
    expect(changes.map((change) => change.changedBy)).toEqual([
      'admin@pentasecurity.com',
      'admin@pentasecurity.com',
      'admin@pentasecurity.com',
    ]);
    // 편집 열기(조회)는 성공 감사를 남기지 않는다
    expect(
      (await state.handle!.db.select().from(auditLogs)).filter(
        (row) => row.action === 'procurement.write' && row.result === 'success',
      ),
    ).toHaveLength(0);
  });

  it('없는 행 상세는 NOT_FOUND, 잘못된 입력은 VALIDATION', async () => {
    state.sessionUserId = adminId;
    const missing = await actions.getDeliveryDetailAction({ id: 987_654 });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const invalid = await actions.excludeDeliveryAction({ id: -1 });
    expect(!invalid.ok && invalid.error.code).toBe('VALIDATION');
    const badUpdate = await actions.updateDeliveryAction({
      id: 1,
      values: { nope: 'x' },
      expected: {},
    } as unknown as Parameters<typeof actions.updateDeliveryAction>[0]);
    expect(!badUpdate.ok && badUpdate.error.code).toBe('VALIDATION');
  });
});

describe('DeliveriesAdminSection (RSC — URL → 서버 조회 → 클라이언트 표 props)', () => {
  it('URL 조건을 코덱으로 파싱해 한 페이지를 읽고, 데이터에 없는 선택지는 버린다', async () => {
    const { DeliveriesAdminSection } =
      await import('@/features/procurement/admin/deliveries/DeliveriesAdminSection');
    const { procurementAccessForTests } = await import('@/server/procurement/access-token');
    await state.handle!.db.insert(procurementDeliveries).values([
      { dlvrReqNo: 'R-S1', itemId: 'T-S', vendor: '섹션상사', dlvrReqDate: '2026-05-01' },
      { dlvrReqNo: 'R-S2', itemId: 'T-S', vendor: '섹션상사', excluded: true },
    ]);
    const access = procurementAccessForTests(
      { id: adminId, email: 'admin@pentasecurity.com' },
      'write',
    );
    const user = { id: adminId, email: 'admin@pentasecurity.com', role: 'ADMIN' } as never;

    const element = await DeliveriesAdminSection({
      params: {
        tab: 'deliveries',
        'f.vendor.in': '섹션상사',
        'f.product.in': '없는제품',
        page: '9',
        sort: 'amount',
        dir: 'desc',
      },
      access,
      user,
    });
    const props =
      element.props as import('@/features/procurement/admin/deliveries/DeliveriesAdmin').DeliveriesAdminProps;
    expect(props.rows.map((row) => row.dlvrReqNo)).toEqual(['R-S1']);
    // 범위를 넘은 page 는 마지막 페이지로, 없는 제품 조건은 버림
    expect(props.view).toEqual({
      trash: false,
      page: 1,
      sort: { id: 'amount', dir: 'desc' },
      filters: [{ col: 'vendor', op: 'in', values: ['섹션상사'] }],
    });
    expect(props).toMatchObject({ total: 1, pageCount: 1, trashCount: 1, userId: adminId });
    expect(props.choices.vendors).toEqual(['가상상사', '섹션상사']);

    const trash = await DeliveriesAdminSection({
      params: { tab: 'deliveries', trash: '1' },
      access,
      user,
    });
    const trashProps = trash.props as typeof props;
    expect(trashProps.rows.map((row) => row.dlvrReqNo)).toEqual(['R-S2']);
    expect(trashProps.view.trash).toBe(true);
  });
});
