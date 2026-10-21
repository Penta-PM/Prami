// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { users, userViewStates } from '@/db/schema';
import { VIEW_QUERY_MAX_BYTES } from '@/lib/page-state/keys';

import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조회 상태 저장소·정규화·재진입 복원 판정 (page-state-memory §2.1-1·§2.2·§2.3·§2.7) — PGlite.
 * 화이트리스트·2KB·본인 행만·사용자 삭제 cascade·변조값 폐기·권한 강등 미적용·redirect 판정(루프 방지)·스크롤 조건 일치.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  referer: null as string | null,
}));

// 원가 화면 정규화는 세션의 cost.read 로 토큰을 얻는다(optionalCostReadAccess) — 세션·DB 만 모킹
vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.referer ? { referer: state.referer } : {}),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { readViewState, writeViewQuery, writeViewScroll } =
  await import('@/server/page-state/store');
const { normalizeViewQuery, toParams, hasParams } = await import('@/server/page-state/normalize');
const { resolveViewRestore, isSamePageReferer } = await import('@/server/page-state/restore');
const { restoreViewState } = await import('@/server/page-state/restore-page');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userA: string;
let userB: string;
let admin: string;

const rows = async () =>
  state.handle!.db.select().from(userViewStates).orderBy(userViewStates.pageKey);

beforeAll(async () => {
  state.handle = await createTestDb();
  userA = (await insertUser(state.handle, { email: 'a@pentasecurity.com', role: 'USER' })).id;
  userB = (await insertUser(state.handle, { email: 'b@pentasecurity.com', role: 'USER' })).id;
  admin = (await insertUser(state.handle, { email: 'adm@pentasecurity.com', role: 'ADMIN' })).id;
});

beforeEach(async () => {
  await state.handle!.db.delete(userViewStates);
  state.sessionUserId = undefined;
  state.referer = null;
  for (const id of [userA, userB, admin]) invalidateSessionUser(id);
});

afterAll(async () => {
  await state.handle?.close();
});

describe('저장소 (user_view_states)', () => {
  it('page_key 화이트리스트 밖은 쓰지도 읽지도 않는다', async () => {
    const db = state.handle!.db;
    expect(await writeViewQuery(db, userA, 'settings', 'q=x')).toBe('rejected');
    expect(await writeViewQuery(db, userA, '__proto__', 'q=x')).toBe('rejected');
    expect(await writeViewScroll(db, userA, 'search', { query: '', top: 10 })).toBe('rejected');
    expect(await rows()).toEqual([]);
    // 직접 넣은 화이트리스트 밖 행도 읽지 않는다
    await db.insert(userViewStates).values({ userId: userA, pageKey: 'settings', query: 'q=x' });
    expect(await readViewState(db, userA, 'settings')).toBeNull();
  });

  it('최대 2KB(UTF-8 바이트) — 넘으면 저장하지 않는다', async () => {
    const db = state.handle!.db;
    const fits = `q=${'a'.repeat(VIEW_QUERY_MAX_BYTES - 2)}`;
    expect(await writeViewQuery(db, userA, 'pricing', fits)).toBe('saved');
    // 한글 1자 = 3바이트 → 글자 수는 적어도 바이트로 넘친다
    const over = `q=${'가'.repeat(700)}`;
    expect(over.length).toBeLessThan(VIEW_QUERY_MAX_BYTES);
    expect(await writeViewQuery(db, userA, 'pricing', over)).toBe('rejected');
    expect((await readViewState(db, userA, 'pricing'))?.query).toBe(fits);
    // '?' 로 시작하는 값은 정규화 형식이 아니다
    expect(await writeViewQuery(db, userA, 'pricing', '?q=x')).toBe('rejected');
  });

  it('upsert — 같은 (user, page) 는 1행, 쿼리 저장은 스크롤을 지우지 않는다', async () => {
    const db = state.handle!.db;
    await writeViewQuery(db, userA, 'pricing', 'q=a');
    await writeViewScroll(db, userA, 'pricing', { query: 'q=a', top: 480 });
    await writeViewQuery(db, userA, 'pricing', 'q=b');
    expect(await rows()).toHaveLength(1);
    expect(await readViewState(db, userA, 'pricing')).toEqual({
      query: 'q=b',
      scroll: { query: 'q=a', top: 480 },
    });
    // 빈 상태('필터 초기화') 저장
    await writeViewQuery(db, userA, 'pricing', '');
    expect((await readViewState(db, userA, 'pricing'))?.query).toBe('');
  });

  it('스크롤만 먼저 저장하면 그 조건으로 행을 만든다. 비정상 값은 거부', async () => {
    const db = state.handle!.db;
    expect(await writeViewScroll(db, userA, 'admin-audit', { query: 'page=2', top: 120 })).toBe(
      'saved',
    );
    expect(await readViewState(db, userA, 'admin-audit')).toEqual({
      query: 'page=2',
      scroll: { query: 'page=2', top: 120 },
    });
    expect(await writeViewScroll(db, userA, 'admin-audit', { query: '', top: -1 })).toBe(
      'rejected',
    );
    expect(await writeViewScroll(db, userA, 'admin-audit', { query: '', top: 1.5 })).toBe(
      'rejected',
    );
  });

  it('본인 행만 — A 의 저장은 B 의 행을 바꾸지 않고, B 로 읽으면 A 의 상태가 보이지 않는다', async () => {
    const db = state.handle!.db;
    await writeViewQuery(db, userB, 'pricing', 'q=b-state');
    await writeViewQuery(db, userA, 'pricing', 'q=a-state');
    expect((await readViewState(db, userB, 'pricing'))?.query).toBe('q=b-state');
    expect((await readViewState(db, userA, 'pricing'))?.query).toBe('q=a-state');
    await writeViewQuery(db, userA, 'calculator', 'tab=margin');
    expect(await readViewState(db, userB, 'calculator')).toBeNull();
  });

  it('사용자 삭제 시 그 사용자의 행도 지워진다 (cascade)', async () => {
    const db = state.handle!.db;
    const temp = await insertUser(state.handle!, { email: 'temp@pentasecurity.com' });
    await writeViewQuery(db, temp.id, 'pricing', 'q=x');
    await writeViewQuery(db, userA, 'pricing', 'q=keep');
    await db.delete(users).where(eq(users.id, temp.id));
    expect((await rows()).map((row) => row.userId)).toEqual([userA]);
  });

  it('변조된 저장값(2KB 초과 쿼리·잘못된 스크롤 JSON)은 읽을 때 버린다', async () => {
    const db = state.handle!.db;
    await db.insert(userViewStates).values({
      userId: userA,
      pageKey: 'pricing',
      query: `q=${'x'.repeat(VIEW_QUERY_MAX_BYTES)}`,
    });
    await db.execute(
      sql`update user_view_states set scroll = '{"query":1,"top":"9"}'::jsonb where user_id = ${userA}`,
    );
    expect(await readViewState(db, userA, 'pricing')).toEqual({ query: '', scroll: null });
  });
});

describe('정규화 (화면별 기존 파서 재사용)', () => {
  const user = { role: 'USER' as const };
  const adminActor = { role: 'ADMIN' as const };

  it('toParams·hasParams', () => {
    expect(toParams('?a=1&a=2&b=')).toEqual({ a: ['1', '2'], b: '' });
    expect(hasParams({})).toBe(false);
    expect(hasParams(toParams('b='))).toBe(true);
  });

  it('가격 조회: 화이트리스트 밖 키·잘못된 값은 버리고 직렬화 순서로 다시 쓴다 (sort·dir 맨 뒤)', async () => {
    const db = state.handle!.db;
    expect(
      await normalizeViewQuery(
        db,
        user,
        'pricing',
        'dir=desc&sort=itemName&evil=1&page=3&q=%20WAPPLES%20&from=bad&f.remark.has=x',
      ),
    ).toBe('q=WAPPLES&f.remark.has=x&page=3&sort=itemName&dir=desc');
    expect(await normalizeViewQuery(db, user, 'pricing', 'foo=bar&page=0')).toBe('');
  });

  it('권한 밖 열 상태 미적용: 조회 화면·pricing.write 없음은 가격 변동 필터·정렬을 버린다', async () => {
    const db = state.handle!.db;
    const raw = 'f.priceChange.gte=5&q=a&sort=priceChange&dir=desc';
    expect(await normalizeViewQuery(db, adminActor, 'admin-policies', raw)).toBe(
      'q=a&f.priceChange.gte=5&sort=priceChange&dir=desc',
    );
    expect(await normalizeViewQuery(db, adminActor, 'pricing', raw)).toBe('q=a');
  });

  it('권한 밖 화면은 항상 빈 쿼리 (권한 강등 뒤 복원 미적용)', async () => {
    const db = state.handle!.db;
    for (const key of [
      'admin-policies',
      'admin-costs',
      'admin-audit',
      'admin-users',
      'admin-notices',
      'admin-parts',
    ] as const) {
      expect(await normalizeViewQuery(db, user, key, 'page=2&f.name.has=a&sort=name')).toBe('');
    }
  });

  it('클라이언트 표(사용자·공지): 열 필터 화이트리스트 순 + 정렬 화이트리스트, 나머지는 버린다', async () => {
    const db = state.handle!.db;
    expect(
      await normalizeViewQuery(
        db,
        adminActor,
        'admin-users',
        'sort=role&dir=sideways&f.role.in=ADMIN&f.name.has=kim&f.secret.has=1&x=1',
      ),
    ).toBe('f.name.has=kim&f.role.in=ADMIN&sort=role&dir=asc');
    expect(await normalizeViewQuery(db, adminActor, 'admin-users', 'sort=actions')).toBe('');
    expect(
      await normalizeViewQuery(db, adminActor, 'admin-notices', 'f.isImportant.in=important'),
    ).toBe('f.isImportant.in=important');
  });

  it('감사·계산기 탭·파츠(데이터에 없는 제품군은 버림)', async () => {
    const db = state.handle!.db;
    expect(
      await normalizeViewQuery(db, adminActor, 'admin-audit', 'page=2&action=auth.login'),
    ).toBe('action=auth.login&page=2');
    expect(await normalizeViewQuery(db, user, 'calculator', 'tab=margin&family=X&item=P1')).toBe(
      'tab=margin',
    );
    expect(await normalizeViewQuery(db, user, 'calculator', 'tab=quote')).toBe('');
    expect(
      await normalizeViewQuery(db, adminActor, 'admin-parts', 'family=NOPE&f.model.has=27'),
    ).toBe('f.model.has=27');
  });

  it('원가: 세션에 cost.read 가 있어야 하고(토큰), 통화 선택지는 현재 데이터 기준', async () => {
    const db = state.handle!.db;
    state.sessionUserId = admin;
    expect(
      await normalizeViewQuery(db, adminActor, 'admin-costs', 'q=W401&f.currency.in=KRW&page=2'),
    ).toBe('q=W401&page=2');
    state.sessionUserId = userA;
    expect(await normalizeViewQuery(db, adminActor, 'admin-costs', 'q=W401')).toBe('');
  });
});

describe('재진입 복원 판정 (resolveViewRestore)', () => {
  const base = () => ({
    db: state.handle!.db,
    userId: userA,
    actor: { role: 'USER' as const },
    referer: null,
  });

  it('파라미터 없는 진입 + 저장값 → 정규화한 쿼리로 redirect', async () => {
    await writeViewQuery(state.handle!.db, userA, 'pricing', 'q=abc&page=2&sort=price&dir=desc');
    const result = await resolveViewRestore({ ...base(), pageKey: 'pricing', params: {} });
    expect(result.redirectTo).toBe('/pricing?q=abc&page=2&sort=price&dir=desc');
  });

  it('파라미터가 명시된 진입은 링크 상태 우선 (redirect 없음)', async () => {
    await writeViewQuery(state.handle!.db, userA, 'pricing', 'q=abc');
    const result = await resolveViewRestore({
      ...base(),
      pageKey: 'pricing',
      params: { family: 'isign' },
    });
    expect(result).toEqual({ redirectTo: null, savedQuery: 'q=abc', restoreTop: null });
  });

  it('루프 방지: 저장값이 비었거나 파서 통과 후 비면 redirect 하지 않는다', async () => {
    const db = state.handle!.db;
    expect(
      (await resolveViewRestore({ ...base(), pageKey: 'pricing', params: {} })).redirectTo,
    ).toBeNull();
    await writeViewQuery(db, userA, 'pricing', '');
    expect(
      (await resolveViewRestore({ ...base(), pageKey: 'pricing', params: {} })).redirectTo,
    ).toBeNull();
    // 변조: 파서가 모두 버리는 값
    await db
      .update(userViewStates)
      .set({ query: 'evil=%3Cscript%3E&page=-1&sort=drop' })
      .where(eq(userViewStates.userId, userA));
    expect(
      (await resolveViewRestore({ ...base(), pageKey: 'pricing', params: {} })).redirectTo,
    ).toBeNull();
  });

  it('변조된 저장값의 권한 밖 열 필터는 버리고 나머지만 복원', async () => {
    await state
      .handle!.db.insert(userViewStates)
      .values({ userId: userA, pageKey: 'pricing', query: 'f.priceChange.gte=1&q=x&page=abc' });
    const result = await resolveViewRestore({ ...base(), pageKey: 'pricing', params: {} });
    expect(result.redirectTo).toBe('/pricing?q=x');
  });

  it('권한 강등: ADMIN 때 저장한 관리 화면 상태는 USER 로 복원하지 않는다', async () => {
    await writeViewQuery(state.handle!.db, userA, 'admin-users', 'f.name.has=kim');
    const result = await resolveViewRestore({ ...base(), pageKey: 'admin-users', params: {} });
    expect(result.redirectTo).toBeNull();
  });

  it('같은 화면 안의 이동(Referer 같은 경로 — 필터 초기화·새로고침)은 복원하지 않는다', async () => {
    await writeViewQuery(state.handle!.db, userA, 'pricing', 'q=old');
    const same = await resolveViewRestore({
      ...base(),
      pageKey: 'pricing',
      params: {},
      referer: 'http://localhost:3000/pricing?q=old',
    });
    expect(same.redirectTo).toBeNull();
    const other = await resolveViewRestore({
      ...base(),
      pageKey: 'pricing',
      params: {},
      referer: 'http://localhost:3000/calculator',
    });
    expect(other.redirectTo).toBe('/pricing?q=old');
    expect(isSamePageReferer('not a url', '/pricing')).toBe(false);
    expect(isSamePageReferer('http://x/pricing/sub', '/pricing')).toBe(false);
  });

  it('스크롤: 현재 정규화 쿼리 == 저장된 scroll.query 일 때만 top, 아니면 null', async () => {
    const db = state.handle!.db;
    await writeViewQuery(db, userA, 'pricing', 'q=abc');
    await writeViewScroll(db, userA, 'pricing', { query: 'q=abc', top: 640 });
    // 정규화 전 표기(앞뒤 공백)가 달라도 같은 조건이면 복원
    const match = await resolveViewRestore({
      ...base(),
      pageKey: 'pricing',
      params: { q: ' abc ' },
    });
    expect(match.restoreTop).toBe(640);
    const differ = await resolveViewRestore({
      ...base(),
      pageKey: 'pricing',
      params: { q: 'abc', page: '2' },
    });
    expect(differ.restoreTop).toBeNull();
    // 빈 조건으로 저장된 스크롤은 파라미터 없는 진입(복원 redirect 없음)에서 복원
    await writeViewQuery(db, userA, 'pricing', '');
    await writeViewScroll(db, userA, 'pricing', { query: '', top: 90 });
    expect(
      (await resolveViewRestore({ ...base(), pageKey: 'pricing', params: {} })).restoreTop,
    ).toBe(90);
  });

  it('다른 사용자(B)는 A 의 상태로 redirect 되지 않는다', async () => {
    await writeViewQuery(state.handle!.db, userA, 'pricing', 'q=a-only');
    const result = await resolveViewRestore({
      ...base(),
      userId: userB,
      pageKey: 'pricing',
      params: {},
    });
    expect(result).toEqual({ redirectTo: null, savedQuery: null, restoreTop: null });
  });
});

describe('화면 RSC 진입 (restoreViewState)', () => {
  it('복원 대상이면 redirect(path?query) — 첫 응답이 복원 상태', async () => {
    await writeViewQuery(state.handle!.db, userA, 'calculator', 'tab=margin');
    await expect(restoreViewState('calculator', {}, { id: userA, role: 'USER' })).rejects.toThrow(
      'REDIRECT:/calculator?tab=margin',
    );
  });

  it('redirect 대상(파라미터 있음)으로 다시 들어오면 복원하지 않고 트래커 props 를 돌려준다', async () => {
    await writeViewQuery(state.handle!.db, userA, 'calculator', 'tab=margin');
    expect(
      await restoreViewState('calculator', { tab: 'margin' }, { id: userA, role: 'USER' }),
    ).toEqual({
      pageKey: 'calculator',
      savedQuery: 'tab=margin',
      restoreTop: null,
    });
  });

  it('같은 화면에서 온 요청(Referer)은 파라미터가 없어도 redirect 하지 않는다', async () => {
    await writeViewQuery(state.handle!.db, userA, 'calculator', 'tab=margin');
    state.referer = 'http://127.0.0.1:3000/calculator?tab=margin';
    expect((await restoreViewState('calculator', {}, { id: userA, role: 'USER' })).savedQuery).toBe(
      'tab=margin',
    );
  });
});
