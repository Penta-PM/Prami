// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { hasPermission } from '@/lib/constants/permissions';
import {
  PAGE_KEYS,
  PAGE_PATHS,
  PAGE_PERMISSIONS,
  isPageKey,
  type PageKey,
} from '@/lib/page-state/keys';
import {
  normalizeProcurementAdminTab,
  parseProcurementAdminTab,
} from '@/lib/procurement/admin-tabs';
import { normalizeViewQuery } from '@/server/page-state/normalize';

/**
 * 조달이 통합 UI-1 — 페이지 상태 기억(B-1) page_key: 조회 화면 3개 = procurement.read, 관리 화면 = procurement.write.
 * 정규화: 조회 화면은 아직 조건 없음(''), 관리 화면은 탭만(기본 탭 생략). 권한 없으면 항상 ''.
 */
const KEYS: Record<string, { path: string; permission: string }> = {
  procurement: { path: '/procurement', permission: 'procurement.read' },
  'procurement-items': { path: '/procurement/items', permission: 'procurement.read' },
  'procurement-bids': { path: '/procurement/bids', permission: 'procurement.read' },
  'admin-procurement': { path: '/admin/procurement', permission: 'procurement.write' },
};

// 조달 키 정규화는 DB 를 읽지 않는다
const db = {} as Db;
const ADMIN = { role: 'ADMIN' as const };
const USER = { role: 'USER' as const };

describe('조달 page_key 화이트리스트', () => {
  it.each(Object.entries(KEYS))('%s: 경로·권한', (key, { path, permission }) => {
    expect(isPageKey(key)).toBe(true);
    expect(PAGE_KEYS).toContain(key);
    expect(PAGE_PATHS[key as PageKey]).toBe(path);
    expect(PAGE_PERMISSIONS[key as PageKey]).toBe(permission);
  });

  it('D-1: USER 는 조회 키만, ADMIN 은 전부 권한이 있다', () => {
    for (const [key, { permission }] of Object.entries(KEYS)) {
      const perm = PAGE_PERMISSIONS[key as PageKey];
      expect(perm).toBe(permission);
      expect(hasPermission('ADMIN', perm)).toBe(true);
      expect(hasPermission('USER', perm)).toBe(permission === 'procurement.read');
    }
  });

  it('경로는 중복되지 않는다', () => {
    const paths = Object.values(PAGE_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('조달 조회 상태 정규화', () => {
  it.each(['procurement', 'procurement-items', 'procurement-bids'] as const)(
    '%s: 아직 조회 조건이 없어 모든 파라미터를 버린다',
    async (key) => {
      expect(await normalizeViewQuery(db, USER, key, 'tab=items&x=1')).toBe('');
      expect(await normalizeViewQuery(db, ADMIN, key, '')).toBe('');
    },
  );

  it('admin-procurement: 알려진 탭만, 기본 탭(deliveries)은 생략, 다른 키는 버린다', async () => {
    expect(await normalizeViewQuery(db, ADMIN, 'admin-procurement', 'tab=items&x=1')).toBe(
      'tab=items',
    );
    expect(await normalizeViewQuery(db, ADMIN, 'admin-procurement', '?tab=keywords')).toBe(
      'tab=keywords',
    );
    expect(await normalizeViewQuery(db, ADMIN, 'admin-procurement', 'tab=deliveries')).toBe('');
    expect(await normalizeViewQuery(db, ADMIN, 'admin-procurement', 'tab=nope')).toBe('');
  });

  it('권한이 없으면(USER → 관리 화면) 항상 빈 상태', async () => {
    expect(await normalizeViewQuery(db, USER, 'admin-procurement', 'tab=items')).toBe('');
  });
});

describe('조달 관리 탭 파서', () => {
  it('모르는 값·없음은 기본 탭', () => {
    expect(parseProcurementAdminTab(undefined)).toBe('deliveries');
    expect(parseProcurementAdminTab('nope')).toBe('deliveries');
    expect(parseProcurementAdminTab('keywords')).toBe('keywords');
    expect(normalizeProcurementAdminTab('deliveries')).toBeNull();
    expect(normalizeProcurementAdminTab(['items'])).toBeNull();
    expect(normalizeProcurementAdminTab('items')).toBe('items');
  });
});
