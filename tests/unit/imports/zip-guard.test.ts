// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { readWorkbook, WorkbookReadError } from '@/server/imports/parse-xlsx';
import { inspectZip, ZipGuardError } from '@/server/imports/zip-guard';

import { fixtureBytes, XLSX_MIME } from '../../helpers/imports';
import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * PR-3 QA 회귀 — MEDIUM: zip 뒤에 바이트가 붙은 xlsx 로 요청이 무응답 / LOW: 10MB 초과 500 / LOW: 압축 해제 크기 상한.
 */
const valid = () => fixtureBytes('sales-200.xlsx');

describe('inspectZip', () => {
  it('정상 xlsx 는 통과하고 항목 수·압축 해제 크기를 돌려준다', () => {
    const summary = inspectZip(valid());
    expect(summary.entries).toBeGreaterThan(3);
    expect(summary.uncompressedBytes).toBeGreaterThan(valid().length);
  });

  it('MEDIUM: 끝에 1바이트만 붙어도 명확한 오류로 거절', () => {
    const appended = Buffer.concat([valid(), Buffer.from('\n')]);
    expect(() => inspectZip(appended)).toThrow(ZipGuardError);
    expect(() => inspectZip(appended)).toThrow(/파일 끝에/);
  });

  it('LOW: 압축 해제 크기 합계가 상한을 넘으면 거절', () => {
    expect(() => inspectZip(valid(), 1024)).toThrow(/압축을 푼 크기가 너무 큽니다/);
  });

  it('zip 이 아니거나 잘린 파일·손상된 디렉터리는 거절', () => {
    expect(() => inspectZip(Buffer.from('short'))).toThrow(ZipGuardError);
    expect(() => inspectZip(Buffer.alloc(100, 1))).toThrow(/손상/);
    expect(() => inspectZip(valid().subarray(0, valid().length - 10))).toThrow(ZipGuardError);
    const broken = Buffer.from(valid());
    const eocd = broken.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    broken.writeUInt32LE(0, eocd + 16); // 중앙 디렉터리 오프셋을 엉뚱한 곳으로
    expect(() => inspectZip(broken)).toThrow(/손상/);
    const zip64 = Buffer.from(valid());
    zip64.writeUInt32LE(0xffffffff, eocd + 16);
    expect(() => inspectZip(zip64)).toThrow(/ZIP64/);
  });
});

describe('readWorkbook', () => {
  it('MEDIUM: 잔여 바이트 파일은 즉시 WorkbookReadError (무응답 아님)', async () => {
    const appended = Buffer.concat([valid(), Buffer.from('trailing')]);
    const started = Date.now();
    await expect(readWorkbook(appended)).rejects.toBeInstanceOf(WorkbookReadError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('파서가 settle 하지 않아도 제한 시간 뒤 WorkbookReadError', async () => {
    vi.resetModules();
    vi.doMock('read-excel-file/node', () => ({ default: () => new Promise(() => undefined) }));
    const { readWorkbook: guarded } = await import('@/server/imports/parse-xlsx');
    await expect(guarded(valid(), 50)).rejects.toThrow(/제한 시간/);
    vi.doUnmock('read-excel-file/node');
    vi.resetModules();
  });
});

describe('POST /api/imports/* 크기 제한 (LOW)', () => {
  let handle: DbHandle;
  let adminId: string;

  beforeAll(async () => {
    handle = await createTestDb();
    adminId = (await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' })).id;
  });

  afterAll(async () => {
    await handle.close();
  });

  async function route() {
    vi.resetModules();
    vi.doMock('@/db', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/db')>()),
      getDb: async () => handle.db,
      getDbHandle: async () => handle,
    }));
    vi.doMock('@/server/auth/auth', () => ({ auth: async () => ({ user: { id: adminId } }) }));
    vi.doMock('@/server/audit/request-meta', () => ({
      currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
    }));
    return (await import('@/app/api/imports/[kind]/route')).POST;
  }

  it('Content-Length 가 10MB+여유를 넘으면 본문을 읽기 전에 413 봉투', async () => {
    const POST = await route();
    const request = new Request('http://localhost/api/imports/sales', {
      method: 'POST',
      headers: {
        'content-length': String(11 * 1024 * 1024),
        'content-type': 'multipart/form-data; boundary=x',
      },
      body: 'x',
    });
    const response = await POST(request, { params: Promise.resolve({ kind: 'sales' }) });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: expect.stringContaining('10MB') },
    });
  });

  it('본문이 잘려 multipart 파싱이 실패하면 500 이 아니라 400 봉투', async () => {
    const POST = await route();
    const request = new Request('http://localhost/api/imports/sales', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=zzz' },
      body: '--zzz\r\nContent-Disposition: form-data; name="file"; filename="a.xlsx"\r\n\r\nPK',
    });
    const response = await POST(request, { params: Promise.resolve({ kind: 'sales' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('10MB 를 넘는 파일 자체는 413, 잔여 바이트 파일은 201 + failed 배치(명확한 메시지)', async () => {
    const POST = await route();
    const big = new FormData();
    big.set(
      'file',
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.xlsx', { type: XLSX_MIME }),
    );
    const tooBig = await POST(
      new Request('http://localhost/api/imports/sales', { method: 'POST', body: big }),
      {
        params: Promise.resolve({ kind: 'sales' }),
      },
    );
    expect(tooBig.status).toBe(413);

    const trailing = new FormData();
    trailing.set(
      'file',
      new File([new Uint8Array(Buffer.concat([valid(), Buffer.from('\n')]))], 'trailing.xlsx', {
        type: XLSX_MIME,
      }),
    );
    const response = await POST(
      new Request('http://localhost/api/imports/sales', { method: 'POST', body: trailing }),
      { params: Promise.resolve({ kind: 'sales' }) },
    );
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data).toMatchObject({ status: 'failed', errorCount: 1 });
    expect(json.data.errors[0].message).toContain('파일 끝에');
  });
});
