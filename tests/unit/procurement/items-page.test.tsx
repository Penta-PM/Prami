import { render, screen, within } from '@testing-library/react';
import { sql } from 'drizzle-orm';
import readXlsxFile from 'read-excel-file/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { procurementDeliveries, procurementItems } from '@/db/schema/procurement';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-2 등록 품목 — PGlite + 실제 가드·조회 계층. 세션·요청 메타·라우터만 모킹. 합성 데이터만(가짜 물품식별번호·업체).
 * - 화면: 서버 정렬·필터·페이지네이션 결과 한 페이지만 렌더, URL 화이트리스트(선택지 = 데이터), 자사 강조, 내려받기 링크.
 * - xlsx Route: procurement.read 가드(비로그인 401), 현재 필터 결과·원 단위 금액, 상한 10,000건 초과 시 잘림 안내.
 * - 조회 상태 정규화(page_key procurement-items): 데이터 선택지로 enum 조건을 다시 확인, 권한 없으면 ''.
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
  currentRequestMeta: async () => ({ ip: '198.51.100.7', userAgent: 'vitest' }),
  currentRequestId: async () => 'req-test',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/procurement/items',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));

const { default: ItemsPage } = await import('@/app/(app)/procurement/items/page');
const { GET } = await import('@/app/(app)/procurement/items/export/route');
const { normalizeViewQuery } = await import('@/server/page-state/normalize');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const M = 1_000_000;

const open = async (params: Record<string, string> = {}) =>
  render(await ItemsPage({ searchParams: Promise.resolve(params) }));

const exportRequest = (query = '') =>
  GET(new Request(`http://localhost/procurement/items/export${query}`));

async function sheetRows(response: Response): Promise<unknown[][]> {
  const buffer = Buffer.from(await response.arrayBuffer());
  const [sheet] = await readXlsxFile(buffer);
  return sheet!.data as unknown[][];
}

const bodyRows = () =>
  within(screen.getByRole('table', { name: '등록 품목 표' }))
    .getAllByRole('row')
    .slice(1);

let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const db = state.handle.db;
  await db.insert(procurementItems).values([
    {
      itemId: 'T-0001',
      product: 'WAPPLES',
      detailCategory: '가상분류A',
      manufacturer: '(주)펜타시큐리티',
      itemName: '가상 웹방화벽 A',
      registeredOn: '2026-03-02',
      status: 'active',
    },
    {
      itemId: 'T-0002',
      product: 'WAPPLES',
      detailCategory: '가상분류B',
      manufacturer: '가상보안',
      itemName: '가상 웹방화벽 B',
      registeredOn: '2026-02-01',
      status: 'active',
    },
    {
      itemId: 'T-0003',
      product: 'D.AMO',
      detailCategory: '가상분류A',
      manufacturer: '가상데이터',
      itemName: '가상 암호화 C',
      registeredOn: '2026-01-15',
      status: 'active',
    },
    // 검토 전(pending) 품목은 등록 품목이 아니다
    {
      itemId: 'T-0004',
      product: 'iSIGN',
      manufacturer: '가상인증',
      itemName: '가상 인증 D',
      registeredOn: '2026-03-10',
      status: 'pending',
    },
  ]);
  await db.insert(procurementDeliveries).values([
    {
      dlvrReqNo: 'R-1',
      itemId: 'T-0001',
      dlvrReqDate: '2026-04-01',
      unitPrice: 123_456_789,
      amount: 123_456_789,
      vendor: '가상상사',
      demandOrg: '가상기관',
    },
    {
      dlvrReqNo: 'R-2',
      itemId: 'T-0002',
      dlvrReqDate: '2026-04-02',
      unitPrice: 4 * M,
      amount: 8 * M,
      vendor: '가상상사',
      demandOrg: '가상기관',
    },
  ]);
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = userId;
});

describe('/procurement/items 화면', () => {
  it('등록(active) 품목만 기본 정렬(등록일자 최신순)로, 계약단가는 백만원·자사 행 강조, 내려받기 링크', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1, name: '등록 품목' })).toBeInTheDocument();
    const rows = bodyRows();
    expect(rows.map((row) => within(row).getAllByRole('cell')[4]?.textContent)).toEqual([
      'T-0001',
      'T-0002',
      'T-0003',
    ]);
    expect(within(rows[0]!).getAllByRole('cell')[6]).toHaveTextContent('123.5');
    expect(within(rows[1]!).getAllByRole('cell')[6]).toHaveTextContent('4.0');
    expect(within(rows[2]!).getAllByRole('cell')[6]).toHaveTextContent('—');
    expect(rows[0]!.className).toContain('bg-accent-ours/8');
    expect(within(rows[0]!).getByText('자사')).toBeInTheDocument();
    expect(rows[1]!.className).not.toContain('accent-ours');
    expect(screen.getByRole('link', { name: 'xlsx 내려받기' })).toHaveAttribute(
      'href',
      '/procurement/items/export',
    );
    expect(screen.getByText('총 3건 · 1 / 1 페이지')).toBeInTheDocument();
  });

  it('URL 필터·정렬은 서버에서 적용 — 선택지(데이터) 밖 값은 버리고, 내려받기 링크가 같은 조건을 싣는다', async () => {
    await open({
      'f.product.in': 'WAPPLES',
      'f.manufacturer.in': '없는회사',
      sort: 'unitPrice',
      dir: 'asc',
    });
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[4]?.textContent)).toEqual([
      'T-0002',
      'T-0001',
    ]);
    expect(screen.getByRole('link', { name: 'xlsx 내려받기' })).toHaveAttribute(
      'href',
      '/procurement/items/export?f.product.in=WAPPLES&sort=unitPrice&dir=asc',
    );
  });

  it('계약단가 범위(원)·검색 q 는 SQL 조건으로', async () => {
    const { unmount } = await open({ 'f.unitPrice.gte': String(5 * M) });
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[4]?.textContent)).toEqual([
      'T-0001',
    ]);
    unmount();
    await open({ q: '암호화' });
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[4]?.textContent)).toEqual([
      'T-0003',
    ]);
  });

  it('필터 결과 0건이면 필터 빈 상태', async () => {
    await open({ q: '존재하지않는품목' });
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
  });
});

describe('xlsx 내려받기 Route', () => {
  it('비로그인은 401 봉투', async () => {
    state.sessionUserId = undefined;
    const response = await exportRequest();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('USER(procurement.read): 현재 필터·정렬 결과, 계약단가는 원 단위 숫자, 잘림 없음', async () => {
    const response = await exportRequest('?f.product.in=WAPPLES&sort=itemId&dir=desc&page=9');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="procurement-items-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(response.headers.get('x-procurement-export-truncated')).toBe('0');
    expect(await sheetRows(response)).toEqual([
      ['등록일자', '제품', '세부분류', '제조사', '물품식별번호', '품목명', '계약단가 (원)'],
      ['2026-02-01', 'WAPPLES', '가상분류B', '가상보안', 'T-0002', '가상 웹방화벽 B', 4 * M],
      [
        '2026-03-02',
        'WAPPLES',
        '가상분류A',
        '(주)펜타시큐리티',
        'T-0001',
        '가상 웹방화벽 A',
        123_456_789,
      ],
    ]);
  });

  it('상한(10,000건)을 넘으면 앞 10,000건 + 파일 끝 안내, 응답 헤더 truncated=1 — 화면도 미리 안내', async () => {
    const db = state.handle!.db;
    await db.execute(
      sql`insert into procurement.items (item_id, product, status, registered_on)
          select 'Z-' || lpad(g::text, 6, '0'), '기타', 'active', date '2020-01-01'
          from generate_series(1, 10001) as g`,
    );
    try {
      const response = await exportRequest('?sort=itemId&dir=asc');
      expect(response.headers.get('x-procurement-export-truncated')).toBe('1');
      const rows = await sheetRows(response);
      // 머리글 1 + 데이터 10,000 + 빈 줄 + 안내 줄
      expect(rows).toHaveLength(10_003);
      expect(rows[1]?.[4]).toBe('T-0001');
      expect(rows[10_000]?.[4]).toBe('Z-009997');
      expect(rows.at(-1)?.[0]).toBe(
        '※ 최대 10,000건까지만 내려받았습니다. 조건을 좁혀 다시 내려받으세요.',
      );
      await open();
      expect(screen.getByText('결과 10,004건 중 앞의 10,000건만 내려받습니다')).toBeInTheDocument();
    } finally {
      await db.execute(sql`delete from procurement.items where item_id like 'Z-%'`);
    }
  }, 60_000);
});

describe('조회 상태 정규화 (page_key procurement-items)', () => {
  const USER = { role: 'USER' as const };

  it('데이터 선택지로 enum 을 다시 확인하고, 화이트리스트 밖 키는 버린다 (화면과 같은 직렬화)', async () => {
    const query = await normalizeViewQuery(
      state.handle!.db,
      USER,
      'procurement-items',
      'x=1&sort=unitPrice&dir=desc&page=2&f.manufacturer.in=가상보안,없는회사&q=가상&f.unitPrice.lte=5000000',
    );
    expect(query).toBe(
      `${new URLSearchParams([
        ['q', '가상'],
        ['f.unitPrice.lte', '5000000'],
        ['page', '2'],
        ['sort', 'unitPrice'],
        ['dir', 'desc'],
      ]).toString()}`,
    );
    expect(
      await normalizeViewQuery(
        state.handle!.db,
        USER,
        'procurement-items',
        'f.manufacturer.in=가상보안',
      ),
    ).toBe(new URLSearchParams([['f.manufacturer.in', '가상보안']]).toString());
  });

  it('enum 조건이 있는데 세션 사용자에게 procurement.read 가 없으면(세션 없음) 빈 상태', async () => {
    state.sessionUserId = undefined;
    expect(
      await normalizeViewQuery(
        state.handle!.db,
        USER,
        'procurement-items',
        'f.product.in=WAPPLES&q=a',
      ),
    ).toBe('');
    // enum 이 없으면 DB·세션 없이 형식 검증만
    expect(
      await normalizeViewQuery(state.handle!.db, USER, 'procurement-items', 'q=a&page=1'),
    ).toBe('q=a');
  });
});

describe('감사', () => {
  it('정상 조회·내려받기는 거부 감사를 남기지 않는다', async () => {
    expect(await auditByAction(state.handle!, 'procurement.read')).toEqual([]);
  });
});
