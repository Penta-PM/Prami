// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import {
  procurementAppState,
  procurementBidNotices,
  procurementDeliveries,
  procurementItems,
  procurementJobRuns,
  type NewProcurementDelivery,
  type NewProcurementItem,
} from '@/db/schema';
import { isOurManufacturer } from '@/lib/procurement/our-company';
import { queryRows } from '@/server/imports/sql-rows';
import { procurementAccessForTests } from '@/server/procurement/access-token';
import { isOursSql } from '@/server/procurement/shared';
import {
  getBidNoticeRows,
  getCollectionStatus,
  getManufacturerPerformance,
  getMonthContracts,
  getMonthlyReport,
  getMonthlyReportByManufacturer,
  getMonthlySeries,
  getMonthVolumes,
  getPerformanceKpis,
  getProcurementItemFacets,
  getProcurementItemPriceRange,
  getProcurementItemRows,
  getProcurementItemRowsForExport,
  getYearlyPerformance,
} from '@/server/procurement/queries';

import { createTestDb } from '../../helpers/pglite';

/**
 * 조달이 통합 DB-2 — 조회 계층 집계 정확도 (PGlite, 합성 데이터만: 가짜 물품식별번호·업체·기관).
 * 첫 변경차수(D-9)·제외(excluded)·비활성/기타 물품 제외·제품 탭/세부 그룹·페이지네이션·전년 대비.
 */
let handle: DbHandle;
const access = procurementAccessForTests();
const M = 1_000_000;

function item(values: Partial<NewProcurementItem> & { itemId: string; product: string }) {
  return { status: 'active', ...values } satisfies NewProcurementItem;
}

function delivery(values: Partial<NewProcurementDelivery> & { dlvrReqNo: string; itemId: string }) {
  return { vendor: '가상상사', demandOrg: '가상기관', ...values } satisfies NewProcurementDelivery;
}

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('자사 판정 SQL (isOursSql) = isOurManufacturer', () => {
  it('공백·라틴 대소문자·비슷한 이름·빈 값·LIKE 특수문자에서 JS 판정과 같다', async () => {
    const names = [
      '(주)펜타시큐리티',
      '펜타 시큐리티',
      'PENTA SECURITY',
      'penta security inc.',
      'PeNtA sEcUrItY',
      'Penta Securities',
      '펜타보안',
      '가상%보안_',
      '',
      '   ',
      null,
    ];
    const values = sql.join(
      names.map((name, index) => sql`(${index}::int, ${name}::text)`),
      sql`, `,
    );
    const rows = await queryRows<{ i: number; ours: boolean }>(
      handle.db,
      sql`select t.i, ${isOursSql(sql`t.name`)} as ours from (values ${values}) as t(i, name) order by t.i`,
    );
    expect(rows.map((row) => row.ours)).toEqual(names.map((name) => isOurManufacturer(name)));
    expect(rows.filter((row) => row.ours)).toHaveLength(5);
  });
});

describe('마지막 수집 시각 — 기록 없음', () => {
  it('job_runs·app_state 가 비어 있으면 collectedAt = null', async () => {
    const status = await getCollectionStatus(access, handle.db);
    expect(status.daily).toEqual({
      job: 'daily',
      lastSuccessAt: null,
      lastRun: null,
      stateUpdatedAt: null,
      collectedAt: null,
    });
    expect(status.bids.collectedAt).toBeNull();
    expect(status.bidsLastCheckedAt).toBeNull();
    expect(status.dailyLastEndDate).toBeNull();
  });

  it('빈 DB: 집계는 0·빈 목록', async () => {
    const period = { from: '2025-01', to: '2025-03' };
    const kpis = await getPerformanceKpis(access, handle.db, { scope: { product: 'ALL' }, period });
    expect(kpis).toMatchObject({
      amount: 0,
      contractCount: 0,
      ourShare: null,
      amountChangeRate: null,
    });
    expect(await getMonthVolumes(access, handle.db, { scope: { product: 'ALL' } })).toEqual({
      first: null,
      last: null,
      months: [],
    });
    expect(await getYearlyPerformance(access, handle.db, { scope: { product: 'ALL' } })).toEqual({
      years: [],
      totals: [],
      manufacturers: [],
      manufacturerCount: 0,
    });
    expect(await getProcurementItemPriceRange(access, handle.db)).toBeUndefined();
  });
});

describe('합성 데이터', () => {
  beforeAll(async () => {
    const db = handle.db;
    await db.insert(procurementItems).values([
      item({
        itemId: 'T-001',
        product: 'WAPPLES',
        manufacturer: '(주)펜타시큐리티',
        detailCategory: 'WAF',
        itemName: '가상 방화벽 A',
        registeredOn: '2025-01-10',
      }),
      item({
        itemId: 'T-002',
        product: 'WAPPLES',
        manufacturer: '가상보안',
        detailCategory: 'WAF',
        itemName: '가상 방화벽 B',
        registeredOn: '2025-03-05',
      }),
      item({
        itemId: 'T-003',
        product: 'D.AMO',
        manufacturer: '(주)펜타시큐리티',
        detailCategory: 'DB암호',
        itemName: '가상 암호화',
        registeredOn: '2024-12-01',
      }),
      item({
        itemId: 'T-004',
        product: 'iSIGN',
        manufacturer: '가상인증',
        detailCategory: 'SSO',
        itemName: '가상 SSO',
        registeredOn: '2025-02-01',
      }),
      item({ itemId: 'T-005', product: 'iSIGN', manufacturer: '가상인증', detailCategory: 'PKI' }),
      item({ itemId: 'T-006', product: '기타', manufacturer: '가상기타' }),
      item({ itemId: 'T-007', product: 'WAPPLES', manufacturer: '가상보안', status: 'excluded' }),
      item({ itemId: 'T-008', product: 'WAPPLES', manufacturer: '가상보안', status: 'pending' }),
    ]);
    await db.insert(procurementDeliveries).values([
      // 첫 차수만 집계 (D-9): 01 차수의 999백만은 빠진다
      delivery({
        dlvrReqNo: 'R-1',
        itemId: 'T-001',
        changeOrd: '00',
        dlvrReqDate: '2025-01-15',
        unitPrice: 50 * M,
        amount: 100 * M,
      }),
      delivery({
        dlvrReqNo: 'R-1',
        itemId: 'T-001',
        changeOrd: '01',
        dlvrReqDate: '2025-02-20',
        unitPrice: 999 * M,
        amount: 999 * M,
      }),
      delivery({
        dlvrReqNo: 'R-2',
        itemId: 'T-002',
        dlvrReqDate: '2025-01-20',
        unitPrice: 30 * M,
        amount: 30 * M,
      }),
      delivery({
        dlvrReqNo: 'R-2',
        itemId: 'T-003',
        dlvrReqDate: '2025-01-20',
        unitPrice: 20 * M,
        amount: 20 * M,
      }),
      delivery({
        dlvrReqNo: 'R-3',
        itemId: 'T-004',
        dlvrReqDate: '2025-03-10',
        unitPrice: 40 * M,
        amount: 40 * M,
      }),
      delivery({
        dlvrReqNo: 'R-4',
        itemId: 'T-005',
        dlvrReqDate: '2025-03-11',
        unitPrice: 10 * M,
        amount: 10 * M,
      }),
      // 전년
      delivery({
        dlvrReqNo: 'R-5',
        itemId: 'T-001',
        dlvrReqDate: '2024-01-05',
        unitPrice: 40 * M,
        amount: 60 * M,
      }),
      delivery({
        dlvrReqNo: 'R-6',
        itemId: 'T-002',
        dlvrReqDate: '2024-03-31',
        unitPrice: 5 * M,
        amount: 5 * M,
      }),
      // 빠지는 것: 기타 물품·휴지통 물품·제외 표시·날짜 없음
      delivery({
        dlvrReqNo: 'R-7',
        itemId: 'T-006',
        dlvrReqDate: '2025-01-01',
        unitPrice: 7 * M,
        amount: 7 * M,
      }),
      delivery({ dlvrReqNo: 'R-8', itemId: 'T-007', dlvrReqDate: '2025-01-02', amount: 8 * M }),
      delivery({
        dlvrReqNo: 'R-9',
        itemId: 'T-001',
        dlvrReqDate: '2025-02-01',
        amount: 9 * M,
        excluded: true,
      }),
      delivery({ dlvrReqNo: 'R-10', itemId: 'T-002', amount: 1 * M }),
    ]);
    await db.insert(procurementBidNotices).values([
      {
        bidNo: 'B-1',
        title: '가상 웹방화벽 도입',
        products: ['WAPPLES'],
        fitGrade: '상',
        fitScore: 90,
        fitReasons: ['＋ 웹방화벽'],
        postedAt: new Date('2025-06-01T00:00:00Z'),
        deadlineAt: new Date('2025-06-12T08:00:00Z'),
        budget: 120 * M,
      },
      {
        bidNo: 'B-2',
        title: '가상 통합 인증',
        products: ['WAPPLES', 'iSIGN'],
        fitGrade: '중',
        fitScore: 80,
        postedAt: new Date('2025-06-02T00:00:00Z'),
        deadlineAt: new Date('2025-06-09T08:00:00Z'),
      },
      {
        bidNo: 'B-3',
        title: '가상 DB 암호화',
        products: ['D.AMO'],
        fitGrade: '상',
        fitScore: 95,
        postedAt: new Date('2025-06-03T00:00:00Z'),
      },
      { bidNo: 'B-4', title: '관련 제품 없음', products: [], fitGrade: '상', fitScore: 99 },
      {
        bidNo: 'B-5',
        title: '가상 인증서',
        products: ['iSIGN'],
        postedAt: new Date('2025-06-05T00:00:00Z'),
        deadlineAt: new Date('2025-06-10T14:30:00Z'),
      },
      {
        bidNo: 'B-6',
        title: '가상 OTP',
        products: ['iSIGN'],
        fitGrade: '하',
        fitScore: 10,
        deadlineAt: new Date('2025-06-10T16:00:00Z'),
      },
    ]);
    await db.insert(procurementJobRuns).values([
      {
        job: 'daily',
        status: 'ok',
        startedAt: new Date('2025-05-31T23:50:00Z'),
        finishedAt: new Date('2025-06-01T00:00:00Z'),
      },
      { job: 'daily', status: 'failed', startedAt: new Date('2025-06-02T00:00:00Z') },
      {
        job: 'bids',
        status: 'ok',
        startedAt: new Date('2025-06-09T00:50:00Z'),
        finishedAt: new Date('2025-06-09T01:00:00Z'),
      },
    ]);
    await db.insert(procurementAppState).values([
      {
        key: 'bids.last_checked',
        value: '2025-06-09T02:00:00Z',
        updatedAt: new Date('2025-06-09T02:00:00Z'),
      },
      {
        key: 'daily.last_end_date',
        value: '2025-05-31',
        updatedAt: new Date('2025-05-31T23:00:00Z'),
      },
    ]);
  });

  describe('조달 실적 현황', () => {
    const all = { product: 'ALL' } as const;
    const q1 = { from: '2025-01', to: '2025-03' };

    it('KPI: 첫 차수·제외·기타/비활성 물품 제외, 계약 건수 = 요구번호 수, 자사·전년 대비', async () => {
      const kpis = await getPerformanceKpis(access, handle.db, { scope: all, period: q1 });
      expect(kpis).toEqual({
        amount: 200 * M,
        contractCount: 4,
        deliveryCount: 5,
        ourAmount: 120 * M,
        ourShare: 0.6,
        previous: { amount: 65 * M, contractCount: 2, deliveryCount: 2, ourAmount: 60 * M },
        amountChangeRate: (200 - 65) / 65,
      });
    });

    it('제품 탭·iSIGN 세부 그룹', async () => {
      const wapples = await getPerformanceKpis(access, handle.db, {
        scope: { product: 'WAPPLES' },
        period: q1,
      });
      expect(wapples.amount).toBe(130 * M);
      expect(wapples.previous.amount).toBe(65 * M);
      const sso = await getPerformanceKpis(access, handle.db, {
        scope: { product: 'iSIGN', group: 'SSO' },
        period: q1,
      });
      expect(sso.amount).toBe(40 * M);
      // 세부 그룹은 iSIGN 탭에서만 — 다른 탭에서는 무시
      const damo = await getPerformanceKpis(access, handle.db, {
        scope: { product: 'D.AMO', group: 'SSO' },
        period: q1,
      });
      expect(damo.amount).toBe(20 * M);
    });

    it('입력 검증: 월 형식·기간 순서·알 수 없는 탭', async () => {
      await expect(
        getPerformanceKpis(access, handle.db, {
          scope: all,
          period: { from: '2025-1', to: '2025-03' },
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        getPerformanceKpis(access, handle.db, {
          scope: all,
          period: { from: '2025-04', to: '2025-03' },
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        getPerformanceKpis(access, handle.db, {
          scope: { product: 'X' as 'ALL' },
          period: q1,
        }),
      ).rejects.toThrow(RangeError);
    });

    it('월별 시리즈: 빈 달 0, 누적, 전년 같은 달', async () => {
      expect(await getMonthlySeries(access, handle.db, { scope: all, period: q1 })).toEqual([
        {
          month: '2025-01',
          amount: 150 * M,
          contractCount: 2,
          ourAmount: 120 * M,
          cumulativeAmount: 150 * M,
          cumulativeOurAmount: 120 * M,
          previousAmount: 60 * M,
        },
        {
          month: '2025-02',
          amount: 0,
          contractCount: 0,
          ourAmount: 0,
          cumulativeAmount: 150 * M,
          cumulativeOurAmount: 120 * M,
          previousAmount: 0,
        },
        {
          month: '2025-03',
          amount: 50 * M,
          contractCount: 2,
          ourAmount: 0,
          cumulativeAmount: 200 * M,
          cumulativeOurAmount: 120 * M,
          previousAmount: 5 * M,
        },
      ]);
    });

    it('월 거래량(슬라이더 범위·배경): 첫 달 ~ 마지막 달, 빈 달 0', async () => {
      const volumes = await getMonthVolumes(access, handle.db, { scope: all });
      expect(volumes.first).toBe('2024-01');
      expect(volumes.last).toBe('2025-03');
      expect(volumes.months).toHaveLength(15);
      expect(volumes.months[0]).toEqual({ month: '2024-01', amount: 60 * M, contractCount: 1 });
      expect(volumes.months[1]).toEqual({ month: '2024-02', amount: 0, contractCount: 0 });
      expect(volumes.months.reduce((sum, m) => sum + m.amount, 0)).toBe(265 * M);
    });

    it('제조사별 실적: 금액 큰 순, 점유율·전년 대비·자사 표시', async () => {
      const result = await getManufacturerPerformance(access, handle.db, {
        scope: all,
        period: q1,
      });
      expect(result.total).toEqual({ amount: 200 * M, contractCount: 4, previousAmount: 65 * M });
      expect(result.rows).toEqual([
        {
          manufacturer: '(주)펜타시큐리티',
          isOurs: true,
          amount: 120 * M,
          contractCount: 2,
          share: 0.6,
          previousAmount: 60 * M,
          changeRate: 1,
        },
        {
          manufacturer: '가상인증',
          isOurs: false,
          amount: 50 * M,
          contractCount: 2,
          share: 0.25,
          previousAmount: 0,
          changeRate: null,
        },
        {
          manufacturer: '가상보안',
          isOurs: false,
          amount: 30 * M,
          contractCount: 1,
          share: 0.15,
          previousAmount: 5 * M,
          changeRate: 5,
        },
      ]);
    });

    it('월 실적 보고표: ALL 탭 = 제품 행 + 합계, 기준월·누적·전년', async () => {
      const report = await getMonthlyReport(access, handle.db, { scope: all, month: '2025-03' });
      expect(report.rows.map((row) => row.key)).toEqual(['WAPPLES', 'D.AMO', 'iSIGN']);
      expect(report.rows[0]).toMatchObject({
        monthAmount: 0,
        ytdAmount: 130 * M,
        previousMonthAmount: 5 * M,
        previousYtdAmount: 65 * M,
        ourYtdAmount: 100 * M,
        ytdChangeRate: (130 - 65) / 65,
      });
      expect(report.rows[2]).toMatchObject({ monthAmount: 50 * M, ytdAmount: 50 * M });
      expect(report.total).toEqual({
        key: null,
        monthAmount: 50 * M,
        monthContractCount: 2,
        ytdAmount: 200 * M,
        ytdContractCount: 4,
        previousMonthAmount: 5 * M,
        previousYtdAmount: 65 * M,
        ourMonthAmount: 0,
        ourYtdAmount: 120 * M,
        ytdChangeRate: (200 - 65) / 65,
        ourYtdShare: 0.6,
      });
    });

    it('월 실적 보고표: iSIGN 탭 = 세부 그룹 행(없는 그룹 0), 단일 제품 탭 = 합계만', async () => {
      const isign = await getMonthlyReport(access, handle.db, {
        scope: { product: 'iSIGN' },
        month: '2025-03',
      });
      expect(isign.rows.map((row) => [row.key, row.ytdAmount])).toEqual([
        ['SSO', 40 * M],
        ['WA', 10 * M],
        ['PASS', 0],
        ['OS 로그온', 0],
        ['기타', 0],
      ]);
      const damo = await getMonthlyReport(access, handle.db, {
        scope: { product: 'D.AMO' },
        month: '2025-01',
      });
      expect(damo.rows).toEqual([]);
      expect(damo.total).toMatchObject({ monthAmount: 20 * M, ourMonthAmount: 20 * M });
    });

    it('월 실적 보고표 제조사별 상세', async () => {
      const rows = await getMonthlyReportByManufacturer(access, handle.db, {
        scope: all,
        month: '2025-03',
      });
      expect(rows.map((row) => [row.key, row.ytdAmount, row.isOurs])).toEqual([
        ['(주)펜타시큐리티', 120 * M, true],
        ['가상인증', 50 * M, false],
        ['가상보안', 30 * M, false],
      ]);
    });

    it('월 계약 목록: 서버 페이지네이션·합계·제조사 한정, 첫 차수 행', async () => {
      const first = await getMonthContracts(access, handle.db, {
        scope: all,
        month: '2025-01',
        pageSize: 2,
      });
      expect(first).toMatchObject({
        total: 3,
        page: 1,
        pageCount: 2,
        pageSize: 2,
        amount: 150 * M,
      });
      expect(first.rows.map((row) => [row.dlvrReqNo, row.itemId, row.amount])).toEqual([
        ['R-2', 'T-002', 30 * M],
        ['R-2', 'T-003', 20 * M],
      ]);
      const clamped = await getMonthContracts(access, handle.db, {
        scope: all,
        month: '2025-01',
        pageSize: 2,
        page: 99,
      });
      expect(clamped.page).toBe(2);
      expect(clamped.rows).toHaveLength(1);
      expect(clamped.rows[0]).toMatchObject({
        dlvrReqNo: 'R-1',
        changeOrd: '00',
        amount: 100 * M,
        manufacturer: '(주)펜타시큐리티',
        product: 'WAPPLES',
      });
      const vendor = await getMonthContracts(access, handle.db, {
        scope: all,
        month: '2025-01',
        manufacturer: '가상보안',
      });
      expect(vendor.rows.map((row) => row.itemId)).toEqual(['T-002']);
      expect(vendor.amount).toBe(30 * M);
    });

    it('연도별 매출·점유율: 연도 합계·자사 점유율, 제조사 금액 큰 순·제한', async () => {
      const yearly = await getYearlyPerformance(access, handle.db, {
        scope: all,
        manufacturerLimit: 2,
      });
      expect(yearly.years).toEqual([2024, 2025]);
      expect(yearly.totals).toEqual([
        { year: 2024, amount: 65 * M, contractCount: 2, ourAmount: 60 * M, ourShare: 60 / 65 },
        { year: 2025, amount: 200 * M, contractCount: 4, ourAmount: 120 * M, ourShare: 0.6 },
      ]);
      expect(yearly.manufacturerCount).toBe(3);
      expect(yearly.manufacturers).toEqual([
        {
          manufacturer: '(주)펜타시큐리티',
          isOurs: true,
          totalAmount: 180 * M,
          years: [
            { year: 2024, amount: 60 * M, share: 60 / 65 },
            { year: 2025, amount: 120 * M, share: 0.6 },
          ],
        },
        {
          manufacturer: '가상인증',
          isOurs: false,
          totalAmount: 50 * M,
          years: [
            { year: 2024, amount: 0, share: 0 },
            { year: 2025, amount: 50 * M, share: 0.25 },
          ],
        },
      ]);
      const everything = await getYearlyPerformance(access, handle.db, { scope: all });
      expect(everything.manufacturers).toHaveLength(3);
    });
  });

  describe('등록 품목', () => {
    it('등록(active)만, 기본 정렬 = 등록일자 최신순(없음은 뒤), 계약단가 = 최근 0 초과 단가', async () => {
      const page = await getProcurementItemRows(access, handle.db, {});
      expect(page).toMatchObject({ total: 6, page: 1, pageCount: 1 });
      expect(page.rows.map((row) => row.itemId)).toEqual([
        'T-002',
        'T-004',
        'T-001',
        'T-003',
        'T-005',
        'T-006',
      ]);
      const t001 = page.rows.find((row) => row.itemId === 'T-001');
      // 첫 차수(v_deliveries) 기준 — 01 차수 단가 999백만은 반영되지 않는다
      expect(t001).toMatchObject({
        unitPrice: 50 * M,
        priceDate: '2025-01-15',
        productGroup: null,
      });
      expect(page.rows.find((row) => row.itemId === 'T-005')).toMatchObject({
        productGroup: 'WA',
        unitPrice: 10 * M,
      });
    });

    it('필터: 제품·제조사·검색·등록일자·계약단가 범위', async () => {
      const ids = async (filter: Parameters<typeof getProcurementItemRows>[2]) =>
        (await getProcurementItemRows(access, handle.db, filter)).rows
          .map((row) => row.itemId)
          .sort();
      expect(await ids({ products: ['WAPPLES'] })).toEqual(['T-001', 'T-002']);
      expect(await ids({ manufacturers: ['가상인증'] })).toEqual(['T-004', 'T-005']);
      expect(await ids({ detailCategories: ['WAF', 'SSO'] })).toEqual(['T-001', 'T-002', 'T-004']);
      expect(await ids({ q: '방화벽' })).toEqual(['T-001', 'T-002']);
      expect(await ids({ q: '%' })).toEqual([]);
      expect(await ids({ registeredFrom: '2025-01-01', registeredTo: '2025-02-28' })).toEqual([
        'T-001',
        'T-004',
      ]);
      expect(await ids({ priceMin: 20 * M, priceMax: 40 * M })).toEqual([
        'T-002',
        'T-003',
        'T-004',
      ]);
      await expect(ids({ registeredFrom: '2025/01/01' })).rejects.toThrow(RangeError);
    });

    it('정렬·페이지네이션: 계약단가 큰 순(단가 없음 뒤), 페이지 건수', async () => {
      const page1 = await getProcurementItemRows(access, handle.db, {
        sort: { id: 'unitPrice', dir: 'desc' },
        pageSize: 4,
      });
      expect(page1).toMatchObject({ total: 6, pageCount: 2, page: 1 });
      expect(page1.rows.map((row) => row.itemId)).toEqual(['T-001', 'T-004', 'T-002', 'T-003']);
      const page2 = await getProcurementItemRows(access, handle.db, {
        sort: { id: 'unitPrice', dir: 'desc' },
        pageSize: 4,
        page: 2,
      });
      expect(page2.rows.map((row) => row.itemId)).toEqual(['T-005', 'T-006']);
      await expect(getProcurementItemRows(access, handle.db, { pageSize: 0 })).rejects.toThrow(
        RangeError,
      );
    });

    it('xlsx 다운로드: 현재 필터 결과 전체', async () => {
      const result = await getProcurementItemRowsForExport(access, handle.db, {
        products: ['iSIGN'],
      });
      expect(result.truncated).toBe(false);
      expect(result.rows.map((row) => row.itemId)).toEqual(['T-004', 'T-005']);
    });

    it('고정 필드 선택지·계약단가 범위 (등록 전체 기준)', async () => {
      const facets = await getProcurementItemFacets(access, handle.db);
      expect(Object.fromEntries(facets.products.map((f) => [f.value, f.count]))).toEqual({
        WAPPLES: 2,
        'D.AMO': 1,
        iSIGN: 2,
        기타: 1,
      });
      expect(Object.fromEntries(facets.manufacturers.map((f) => [f.value, f.count]))).toEqual({
        '(주)펜타시큐리티': 2,
        가상보안: 1,
        가상인증: 2,
        가상기타: 1,
      });
      expect(facets.detailCategories.map((f) => f.value).sort()).toEqual(
        ['DB암호', 'PKI', 'SSO', 'WAF'].sort(),
      );
      expect(await getProcurementItemPriceRange(access, handle.db)).toEqual({
        currency: 'KRW',
        min: 7 * M,
        max: 50 * M,
        minPositive: 7 * M,
      });
    });
  });

  describe('입찰 공고', () => {
    const now = new Date('2025-06-10T03:00:00Z'); // KST 2025-06-10 12:00

    it('기본: 진행 중만, 적합도순(등급 → 점수 → 최신), 관련 제품 없는 공고 숨김, 칩 건수', async () => {
      const page = await getBidNoticeRows(access, handle.db, { now });
      expect(page.rows.map((row) => row.bidNo)).toEqual(['B-3', 'B-1', 'B-6', 'B-5']);
      expect(page.allCount).toBe(4);
      expect(page.total).toBe(4);
      expect(page.productCounts).toEqual([
        { product: 'WAPPLES', count: 1 },
        { product: 'D.AMO', count: 1 },
        { product: 'iSIGN', count: 2 },
      ]);
    });

    it('D-day (KST 날짜 기준)·마감 여부·금액', async () => {
      const page = await getBidNoticeRows(access, handle.db, { now, includeClosed: true });
      const byNo = Object.fromEntries(page.rows.map((row) => [row.bidNo, row]));
      expect(byNo['B-1']).toMatchObject({ daysLeft: 2, closed: false, budget: 120 * M });
      expect(byNo['B-2']).toMatchObject({ daysLeft: -1, closed: true });
      expect(byNo['B-3']).toMatchObject({ daysLeft: null, closed: false });
      expect(byNo['B-5']).toMatchObject({ daysLeft: 0, closed: false }); // KST 06-10 23:30
      expect(byNo['B-6']).toMatchObject({ daysLeft: 1, closed: false }); // KST 06-11 01:00
      expect(byNo['B-1']!.fitReasons).toEqual(['＋ 웹방화벽']);
      expect(page.rows.map((row) => row.bidNo)).toEqual(['B-3', 'B-1', 'B-2', 'B-6', 'B-5']);
      expect(page.productCounts).toEqual([
        { product: 'WAPPLES', count: 2 },
        { product: 'D.AMO', count: 1 },
        { product: 'iSIGN', count: 3 },
      ]);
    });

    it("제품 칩·'상'만·공고 최신순·페이지네이션", async () => {
      const isign = await getBidNoticeRows(access, handle.db, { now, product: 'iSIGN' });
      expect(isign.rows.map((row) => row.bidNo)).toEqual(['B-6', 'B-5']);
      expect(isign.total).toBe(2);
      expect(isign.allCount).toBe(4);
      const top = await getBidNoticeRows(access, handle.db, { now, topGradeOnly: true });
      expect(top.rows.map((row) => row.bidNo)).toEqual(['B-3', 'B-1']);
      const posted = await getBidNoticeRows(access, handle.db, { now, sort: 'posted' });
      expect(posted.rows.map((row) => row.bidNo)).toEqual(['B-5', 'B-3', 'B-1', 'B-6']);
      const paged = await getBidNoticeRows(access, handle.db, { now, pageSize: 3, page: 2 });
      expect(paged).toMatchObject({ page: 2, pageCount: 2, total: 4 });
      expect(paged.rows.map((row) => row.bidNo)).toEqual(['B-5']);
      await expect(
        getBidNoticeRows(access, handle.db, { now, product: '기타' as 'iSIGN' }),
      ).rejects.toThrow(RangeError);
    });
  });

  it('마지막 수집 시각: job_runs 성공 종료·app_state 갱신 중 늦은 것, 최근 실행 상태', async () => {
    const status = await getCollectionStatus(access, handle.db);
    expect(status.daily.lastSuccessAt).toEqual(new Date('2025-06-01T00:00:00Z'));
    expect(status.daily.lastRun?.status).toBe('failed');
    expect(status.daily.collectedAt).toEqual(new Date('2025-06-01T00:00:00Z'));
    expect(status.bids.collectedAt).toEqual(new Date('2025-06-09T02:00:00Z'));
    expect(status.bidsLastCheckedAt).toEqual(new Date('2025-06-09T02:00:00Z'));
    expect(status.dailyLastEndDate).toBe('2025-05-31');
  });
});
