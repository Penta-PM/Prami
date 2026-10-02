// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';

import { fixtureBytes, XLSX_MIME } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/** POST /api/imports/{kind} + applyPolicyAction — 권한(pricing.write/cost.write/parts.write)·봉투·감사 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  fault: undefined as string | undefined,
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
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    get env() {
      return { ...actual.env, NODE_ENV: 'test', IMPORT_FAULT_INJECTION: state.fault };
    },
  };
});

const { POST } = await import('@/app/api/imports/[kind]/route');
const { applyPolicyAction } = await import('@/features/admin-policies/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;

function upload(kind: string, name: string, bytes = fixtureBytes(name)) {
  const body = new FormData();
  body.set('file', new File([new Uint8Array(bytes)], name, { type: XLSX_MIME }));
  const request = new Request(`http://localhost/api/imports/${kind}`, { method: 'POST', body });
  return POST(request, { params: Promise.resolve({ kind }) });
}

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = adminId;
  state.fault = undefined;
});

describe('POST /api/imports/{kind}', () => {
  it('알 수 없는 종류 404, 비로그인 401, USER 403(+감사 denied)', async () => {
    expect((await upload('unknown', 'sales-200.xlsx')).status).toBe(404);
    state.sessionUserId = undefined;
    expect((await upload('sales', 'sales-200.xlsx')).status).toBe(401);
    state.sessionUserId = userId;
    const denied = await upload('sales', 'sales-200.xlsx');
    expect(denied.status).toBe(403);
    const logs = await auditByAction(state.handle!, 'import.upload');
    expect(logs.some((log) => log.targetId === '/api/imports/sales')).toBe(true);
  });

  it('ADMIN 업로드 201 → 미리보기·오류 목록, 재업로드 409 + 기존 배치 id', async () => {
    const response = await upload('sales', 'sales-200.xlsx');
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toMatchObject({
      ok: true,
      data: { status: 'parsed', rowCount: 200, errorCount: 0 },
    });
    expect(json.data.preview).toHaveLength(20);

    const again = await upload('sales', 'sales-200.xlsx');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { existingBatchId: json.data.batchId } },
    });
  });

  it('file 필드 누락 400, 원가·파츠(존재하지 않는 품번 행 오류)', async () => {
    const empty = await POST(
      new Request('http://localhost/api/imports/sales', { method: 'POST', body: new FormData() }),
      { params: Promise.resolve({ kind: 'sales' }) },
    );
    expect(empty.status).toBe(400);
    const costs = await (await upload('costs', 'costs-sample.xlsx')).json();
    expect(costs.data).toMatchObject({ status: 'parsed', rowCount: 3, errorCount: 0 });
    const parts = await (await upload('parts', 'parts-sample.xlsx')).json();
    expect(parts.data.errorCount).toBeGreaterThanOrEqual(1);
    expect(parts.data.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'NOPE-0000' })]),
    );
  });

  it('QA L-1: Content-Length 초과 413 문구가 상한별로 다르다 — 품목 합계 25MB / 단일 파일 10MB', async () => {
    const MB = 1024 * 1024;
    const post = (kind: string, declared: number) =>
      POST(
        new Request(`http://localhost/api/imports/${kind}`, {
          method: 'POST',
          body: new FormData(),
          headers: { 'content-length': String(declared) },
        }),
        { params: Promise.resolve({ kind }) },
      );
    const items = await post('items', 26 * MB);
    expect(items.status).toBe(413);
    expect((await items.json()).error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: '품목조회 파일 합계는 25MB 이하만 업로드할 수 있습니다',
    });
    const sales = await post('sales', 11 * MB);
    expect(sales.status).toBe(413);
    expect((await sales.json()).error.message).toBe('파일은 10MB 이하만 업로드할 수 있습니다');
  });

  it('AC-373 ① (PR #21 I-9): 품목 파일 하나가 10MB 초과(합계는 25MB 이하) → 413 PAYLOAD_TOO_LARGE, 단일 종류와 같은 문구', async () => {
    state.sessionUserId = adminId;
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const body = new FormData();
    body.append('files', new File([big], 'items-big.xlsx', { type: XLSX_MIME }));
    const response = await POST(
      new Request('http://localhost/api/imports/items', { method: 'POST', body }),
      { params: Promise.resolve({ kind: 'items' }) },
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: '파일은 10MB 이하만 업로드할 수 있습니다',
    });
  });
});

describe('applyPolicyAction', () => {
  it('USER 는 FORBIDDEN (AC-04 applyPolicy), 잘못된 입력은 VALIDATION', async () => {
    state.sessionUserId = userId;
    const denied = await applyPolicyAction({
      salesBatchId: '00000000-0000-4000-8000-000000000000',
      itemBatchId: null,
      salesReused: false,
      itemReused: false,
    });
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    state.sessionUserId = adminId;
    const invalid = await applyPolicyAction({
      salesBatchId: 'nope',
      itemBatchId: null,
      salesReused: false,
      itemReused: false,
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('ADMIN 적용 성공 → stats, 실패 주입(env) → INTERNAL 봉투 + runId', async () => {
    const batch = await (await upload('sales', 'sales-200.xlsx')).json();
    const batchId = batch.ok ? batch.data.batchId : batch.error.details.existingBatchId;
    const ok = await applyPolicyAction({
      salesBatchId: batchId,
      itemBatchId: null,
      salesReused: true,
      itemReused: false,
    });
    expect(ok).toMatchObject({ ok: true, data: { stats: { inserted: 200 } } });

    state.fault = 'recompute';
    const failed = await applyPolicyAction({
      salesBatchId: batchId,
      itemBatchId: null,
      salesReused: true,
      itemReused: false,
    });
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    if (failed.ok) throw new Error('unreachable');
    expect(failed.error.message).toContain('recompute');
    expect(failed.error.details).toMatchObject({ runId: expect.any(String) });
  });
});
