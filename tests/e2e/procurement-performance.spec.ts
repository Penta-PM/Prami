import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_USER, loginAs } from './helpers';

/**
 * 조달이 통합 UI-5 (조달 실적 현황 `/procurement`): 제품 탭·조회 기간(프리셋)·기준월 → URL(replace), KPI 억·만,
 * 월 실적 보고표·제조사별 실적표 모달, 콤보 차트 ↔ 제조사 표 강조 연동(mfr), 월 클릭 → 계약 목록(서버 페이지네이션),
 * 연도별 더보기 모달, 320px 가로 스크롤 없음(표는 표 안에서만 스크롤).
 *
 * E2E DB 에는 조달 데이터가 없다 → 이 스펙이 **합성** 품목·납품요구(가상 제조사·기관)를 넣고 전후로 지운다.
 * 기간은 URL 로 고정(2025-01~03)해 오늘 날짜와 무관. workers 1 · serial — 끝나면 조회 상태(page_key procurement)도 지운다
 * (procurement-shell 스펙이 빈 상태를 본다).
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = 'E2E-PERF-';
const M = 1_000_000;
const Q1 = '/procurement?from=2025-01&to=2025-03&month=2025-03';

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function cleanUp(client: pg.Client) {
  await client.query(`delete from procurement.deliveries where dlvr_req_no like $1`, [
    `${PREFIX}%`,
  ]);
  await client.query(`delete from procurement.items where item_id like $1`, [`${PREFIX}%`]);
  await client.query(
    `delete from user_view_states v using users u
     where u.id = v.user_id and u.email = $1 and v.page_key = 'procurement'`,
    [FIXTURE_USER],
  );
}

const ITEMS = [
  { id: `${PREFIX}I1`, product: 'WAPPLES', manufacturer: '(주)펜타시큐리티' },
  { id: `${PREFIX}I2`, product: 'WAPPLES', manufacturer: 'E2E가상보안' },
  { id: `${PREFIX}I3`, product: 'iSIGN', manufacturer: 'E2E가상인증' },
];

type Delivery = { no: string; item: string; date: string; amount: number; ord?: string };

const DELIVERIES: Delivery[] = [
  { no: `${PREFIX}R-OURS`, item: `${PREFIX}I1`, date: '2025-01-10', amount: 100 * M },
  // 변경차수 01 은 집계에서 빠진다 (D-9 첫 변경차수)
  { no: `${PREFIX}R-OURS`, item: `${PREFIX}I1`, date: '2025-01-20', amount: 999 * M, ord: '01' },
  ...Array.from({ length: 55 }, (_, index) => ({
    no: `${PREFIX}R-RIVAL-${String(index).padStart(3, '0')}`,
    item: `${PREFIX}I2`,
    date: `2025-01-${String(1 + (index % 28)).padStart(2, '0')}`,
    amount: 1 * M,
  })),
  { no: `${PREFIX}R-SSO`, item: `${PREFIX}I3`, date: '2025-03-05', amount: 40 * M },
  { no: `${PREFIX}R-PREV`, item: `${PREFIX}I1`, date: '2024-03-15', amount: 50 * M },
];

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    for (const item of ITEMS) {
      await client.query(
        `insert into procurement.items (item_id, product, manufacturer, detail_category, status)
         values ($1, $2, $3, $4, 'active')`,
        [item.id, item.product, item.manufacturer, item.product === 'iSIGN' ? 'SSO' : null],
      );
    }
    for (const delivery of DELIVERIES) {
      await client.query(
        `insert into procurement.deliveries
           (dlvr_req_no, item_id, change_ord, dlvr_req_date, amount, demand_org, vendor, contract_no, item_name)
         values ($1, $2, $3, $4, $5, 'E2E 가상 수요기관', 'E2E 가상상사', $6, 'E2E 가상 품목')`,
        [
          delivery.no,
          delivery.item,
          delivery.ord ?? '00',
          delivery.date,
          delivery.amount,
          `C-${delivery.no}`,
        ],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

test.beforeEach(async ({ page }) => {
  await loginAs(page, FIXTURE_USER, Q1);
});

const manufacturerTable = (page: Page) => page.getByTestId('manufacturer-table');

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
}

test('KPI(억·만)·월 실적 보고표·제조사별 실적표 모달', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: '조달 실적 현황' })).toBeVisible();
  await expect(page.locator('[data-kpi="amount"] dd').first()).toHaveText('1억');
  await expect(page.locator('[data-kpi="share"] dd').first()).toHaveText('51.3%');
  await expect(page.locator('[data-kpi="yoy"] dd').first()).toHaveText('+100.0%');

  const report = page.getByTestId('monthly-report');
  await expect(report.getByRole('heading', { level: 2 })).toHaveText('전체 25년 조달 3월 실적');
  await expect(report.getByTestId('our-monthly-table')).toContainText('100.0');

  await report.getByRole('button', { name: '제조사별 실적표 ⤢' }).click();
  const dialog = page.getByRole('dialog', { name: '전체 25년 3월 제조사별 실적 (단위: 백만원)' });
  await expect(dialog.getByTestId('manufacturer-report-table')).toContainText('소계');
  await expect(dialog.getByTestId('manufacturer-report-table')).toContainText('E2E가상보안');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('제품 탭·기간 프리셋·기준월 → URL(replace)', async ({ page }) => {
  await page.getByRole('group', { name: '제품' }).getByRole('button', { name: 'WAPPLES' }).click();
  await expect(page).toHaveURL(/\/procurement\?tab=WAPPLES&from=2025-01&to=2025-03$/);
  await expect(manufacturerTable(page)).not.toContainText('E2E가상인증');

  await page.getByLabel('기준월').selectOption('2025-01');
  await expect(page).toHaveURL(/tab=WAPPLES&from=2025-01&to=2025-03&month=2025-01$/);
  await expect(page.getByTestId('monthly-report').getByRole('heading', { level: 2 })).toHaveText(
    'WAPPLES 25년 조달 1월 실적',
  );

  await page.getByRole('group', { name: '제품' }).getByRole('button', { name: 'iSIGN' }).click();
  await page
    .getByRole('group', { name: 'iSIGN 세부 그룹' })
    .getByRole('button', { name: 'SSO' })
    .click();
  await expect(page).toHaveURL(/tab=iSIGN&group=SSO/);
  await expect(page.getByTestId('monthly-report')).toContainText('iSIGN · SSO');

  // 전체 = 이 범위(SSO)의 첫 실적 달 ~ 이번 달
  await page
    .getByRole('group', { name: '기간 프리셋' })
    .getByRole('button', { name: '전체' })
    .click();
  await expect(page).toHaveURL(/group=SSO&from=2025-03&to=\d{4}-\d{2}$/);
});

test('콤보 차트 ↔ 제조사 표 강조 연동 → 월 클릭 → 계약 목록(서버 페이지네이션)', async ({
  page,
}) => {
  await manufacturerTable(page).getByRole('button', { name: 'E2E가상보안', exact: true }).click();
  await expect(page).toHaveURL(/mfr=m%3AE2E%EA%B0%80%EC%83%81%EB%B3%B4%EC%95%88/);
  const legend = page.getByRole('list', { name: '전체 월별 매출 추이 범례' });
  await expect(legend.getByRole('button', { name: 'E2E가상보안', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // 키보드: 차트에 들어가 첫 달(1월)에서 Enter
  const plot = page.getByRole('group', { name: '전체 월별 매출 추이' });
  await plot.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sel=2025-01/);
  const list = page.getByTestId('month-contracts');
  await expect(list.getByRole('heading', { level: 3 })).toHaveText(
    'E2E가상보안 · 25.01 계약 목록 (55건 · 5,500만)',
  );
  await expect(list.locator('[data-contract-row]')).toHaveCount(50);
  await list.getByRole('link', { name: '다음' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(list.locator('[data-contract-row]')).toHaveCount(5);

  // 강조 해제 → 전체 계약
  await legend.getByRole('button', { name: 'E2E가상보안', exact: true }).click();
  await expect(list.getByRole('heading', { level: 3 })).toContainText(
    '전체 · 25.01 계약 목록 (56건',
  );
  await list.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page).not.toHaveURL(/sel=/);
});

test('연도별 매출액·점유율 + 더보기 모달', async ({ page }) => {
  const amount = page.locator('[data-yearly-table="amount"]');
  await expect(amount.getByRole('columnheader')).toHaveText(['제조사', '2024', '2025', '합계']);
  await page.getByRole('button', { name: '연도별 점유율 현황 더보기' }).click();
  const dialog = page.getByRole('dialog', { name: '연도별 점유율 현황' });
  await expect(dialog.locator('[data-yearly-table="share"]')).toContainText('E2E가상보안');
});

test('조회 상태 기억: 다시 들어오면 마지막 조건', async ({ page }) => {
  await page.getByRole('group', { name: '제품' }).getByRole('button', { name: 'D.AMO' }).click();
  await expect(page).toHaveURL(/tab=D\.AMO/);
  await expect(page.getByRole('status')).toContainText('D.AMO 조달 실적이 없습니다');
  await expect
    .poll(
      () =>
        withDb(async (client) => {
          const { rows } = await client.query<{ query: string }>(
            `select v.query from user_view_states v join users u on u.id = v.user_id
             where u.email = $1 and v.page_key = 'procurement'`,
            [FIXTURE_USER],
          );
          return rows[0]?.query ?? null;
        }),
      { timeout: 10_000 },
    )
    .toBe('tab=D.AMO&from=2025-01&to=2025-03');
  await page.goto('/procurement');
  await expect(page).toHaveURL(/\/procurement\?tab=D\.AMO&from=2025-01&to=2025-03$/);
});

test('320px: 페이지 가로 스크롤 없음, 표는 표 안에서만 스크롤', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${Q1}&sel=2025-01`);
  await expect(page.getByTestId('month-contracts')).toBeVisible();
  await expectNoHorizontalScroll(page);
  const wrapper = await page.getByTestId('our-monthly-table').evaluate((element) => {
    const parent = element.parentElement!;
    return { scroll: parent.scrollWidth, client: parent.clientWidth };
  });
  expect(wrapper.scroll).toBeGreaterThan(wrapper.client);
});
