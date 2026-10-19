// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { filterToQuery } from '@/features/audit/query';
import { auditLogs } from '@/db/schema';
import { normalizeIp, toAuditRow, writeAudit } from '@/server/audit/log';
import {
  AUDIT_PAGE_SIZE,
  getAuditLogs,
  getAuditLogsForExport,
  listAuditActions,
  parseAuditFilter,
} from '@/server/audit/queries';

import { createTestDb } from '../../helpers/pglite';

/** 감사 로그 화면 (§4.5.10): 필터(기간·행위·사용자), 페이지 50 */
let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
  // 60건: 한국 시간 기준 2026-09-01 ~ 2026-09-03 에 걸쳐 분포
  const rows = Array.from({ length: 60 }, (_, index) => ({
    ...toAuditRow({
      actor: { id: null, label: index % 2 === 0 ? 'kim@pentasecurity.com' : 'lee_50%@x.com' },
      action: index < 55 ? 'auth.login' : 'user.update',
      result: 'success',
    }),
    createdAt: new Date(Date.UTC(2026, 7, 31, 15 + index)), // 15:00Z = 00:00 KST
  }));
  await handle.db.insert(auditLogs).values(rows);
});

afterAll(async () => {
  await handle.close();
});

describe('parseAuditFilter', () => {
  it('URL 값을 정규화하고 잘못된 값은 버린다', () => {
    expect(
      parseAuditFilter({
        from: '2026-09-01',
        to: 'bad',
        action: ' ',
        actor: ['kim', 'x'],
        page: '-3',
      }),
    ).toEqual({ from: '2026-09-01', to: undefined, action: undefined, actor: 'kim', page: 1 });
    expect(parseAuditFilter({ page: '2' }).page).toBe(2);
  });

  it('정렬 sort·dir: 화이트리스트만 받고 filterToQuery 는 맨 뒤에 붙인다 (#32 §3)', () => {
    const filter = parseAuditFilter({ actor: 'kim', page: '2', sort: 'result', dir: 'desc' });
    expect(filter).toEqual({
      from: undefined,
      to: undefined,
      action: undefined,
      actor: 'kim',
      page: 2,
      sort: { id: 'result', dir: 'desc' },
    });
    expect(filterToQuery(filter)).toBe('?actor=kim&page=2&sort=result&dir=desc');
    expect(filterToQuery({ page: 1, sort: { id: 'ip', dir: 'asc' } })).toBe('?sort=ip&dir=asc');
    expect(parseAuditFilter({ sort: 'id;drop', dir: 'asc' }).sort).toBeUndefined();
    expect(parseAuditFilter({ sort: 'before' }).sort).toBeUndefined();
    expect('sort' in parseAuditFilter({})).toBe(false);
  });
});

describe('getAuditLogs', () => {
  it('최신순 50건씩 페이지를 나누고 범위를 넘는 페이지는 마지막으로 보정한다', async () => {
    const first = await getAuditLogs(handle.db, parseAuditFilter({}));
    expect(first).toMatchObject({ total: 60, page: 1, pageCount: 2, pageSize: AUDIT_PAGE_SIZE });
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]!.createdAt.getTime()).toBeGreaterThan(first.rows[1]!.createdAt.getTime());

    const beyond = await getAuditLogs(handle.db, parseAuditFilter({ page: '9' }));
    expect(beyond.page).toBe(2);
    expect(beyond.rows).toHaveLength(10);
  });

  it('기간(한국 시간 날짜)·행위·사용자(부분 일치, 와일드카드 이스케이프)로 거른다', async () => {
    const day1 = await getAuditLogs(
      handle.db,
      parseAuditFilter({ from: '2026-09-01', to: '2026-09-01' }),
    );
    expect(day1.total).toBe(24);

    const updates = await getAuditLogs(handle.db, parseAuditFilter({ action: 'user.update' }));
    expect(updates.total).toBe(5);

    const lee = await getAuditLogs(handle.db, parseAuditFilter({ actor: '_50%' }));
    expect(lee.total).toBe(30);
    const wildcard = await getAuditLogs(handle.db, parseAuditFilter({ actor: '%' }));
    expect(wildcard.total).toBe(30); // '%' 는 문자 그대로 비교된다
  });

  it('행위 목록과 CSV 내보내기용 전체 조회', async () => {
    expect(await listAuditActions(handle.db)).toEqual(['auth.login', 'user.update']);
    expect(await getAuditLogsForExport(handle.db, parseAuditFilter({}))).toHaveLength(60);
  });
});

describe('audit/log', () => {
  it('normalizeIp: 단일 값 정규화(포트 제거), inet 이 아닌 값·목록 문자열은 버림', () => {
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('203.0.113.9:443')).toBe('203.0.113.9');
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('203.0.113.9, 10.0.0.1')).toBeNull();
    expect(normalizeIp('unknown')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
  });

  it('writeAudit 는 요청 정보를 포함해 1건을 기록한다', async () => {
    await writeAudit(handle.db, {
      actor: { id: null, label: 'system' },
      action: 'test.write',
      target: { type: 'user' },
      reason: '테스트',
      meta: { ip: '10.1.2.3', userAgent: 'x'.repeat(600) },
    });
    const [row] = await getAuditLogsForExport(
      handle.db,
      parseAuditFilter({ action: 'test.write' }),
    );
    expect(row).toMatchObject({ ip: '10.1.2.3', targetType: 'user', result: 'success' });
    expect(row?.userAgent).toHaveLength(512);
  });
});
