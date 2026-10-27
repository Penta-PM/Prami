import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import readXlsxFile from 'read-excel-file/node';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_USER, loginAs } from './helpers';

/**
 * 조달이 통합 UI-2 등록 품목 (/procurement/items, procurement.read). E2E DB 의 조달 표는 비어 있으므로 이 스펙이 합성 품목·납품을
 * 넣고(물품식별번호 `E2E-UI2-` 접두) 끝나면 지운다. 서버 정렬·필터·페이지네이션(한 페이지 50행), URL 딥링크·뒤로 가기,
 * 계약단가 슬라이더, 자사 강조, xlsx 내려받기(현재 필터 결과, 원 단위), 320px 가로 스크롤 없음.
 */
const PREFIX = 'E2E-UI2-';
const M = 1_000_000;
/** 페이지 크기(50)를 넘겨 2페이지가 생기게 */
const FILLER_COUNT = 55;

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanup(client: pg.Client) {
  await client.query(`delete from procurement.deliveries where item_id like $1`, [`${PREFIX}%`]);
  await client.query(`delete from procurement.items where item_id like $1`, [`${PREFIX}%`]);
}

test.beforeAll(async () => {
  await withClient(async (client) => {
    await cleanup(client);
    const named = [
      ['A001', 'WAPPLES', '가상분류A', '(주)펜타시큐리티', '가상 웹방화벽 E2E', '2026-09-30'],
      ['A002', 'WAPPLES', '가상분류B', '가상보안E2E', '가상 웹방화벽 경쟁', '2026-09-29'],
      ['A003', 'D.AMO', '가상분류A', '가상데이터E2E', '가상 암호화 E2E', '2026-09-28'],
    ] as const;
    for (const [suffix, product, detail, manufacturer, name, registered] of named) {
      await client.query(
        `insert into procurement.items (item_id, product, detail_category, manufacturer, item_name, registered_on, status)
         values ($1, $2, $3, $4, $5, $6, 'active')`,
        [`${PREFIX}${suffix}`, product, detail, manufacturer, name, registered],
      );
    }
    await client.query(
      `insert into procurement.items (item_id, product, manufacturer, item_name, registered_on, status)
       select $1 || 'F' || lpad(g::text, 3, '0'), '기타', '가상채움E2E', '가상 채움 품목', date '2020-01-01', 'active'
       from generate_series(1, $2::int) as g`,
      [PREFIX, FILLER_COUNT],
    );
    const deliveries = [
      ['R1', 'A001', 123_456_789],
      ['R2', 'A002', 4 * M],
      ['R3', 'A003', 250 * M],
    ] as const;
    for (const [no, suffix, price] of deliveries) {
      await client.query(
        `insert into procurement.deliveries (dlvr_req_no, item_id, dlvr_req_date, unit_price, amount, vendor, demand_org)
         values ($1, $2, date '2026-10-01', $3, $3, '가상상사E2E', '가상기관E2E')`,
        [`${PREFIX}${no}`, `${PREFIX}${suffix}`, price],
      );
    }
  });
});

test.afterAll(async () => {
  await withClient(cleanup);
});

const table = (page: Page) => page.getByRole('table', { name: '등록 품목 표' });
const bar = (page: Page) => page.locator('[data-quick-filter-bar]');
const itemIds = (page: Page) => table(page).locator('tbody tr td:nth-child(5)');

test.beforeEach(async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/procurement/items');
});

test('기본: 등록일자 최신순 50행, 계약단가 백만원 머리글, 자사 행 강조·배지, 2페이지 이동(push)', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1, name: '등록 품목' })).toBeVisible();
  await expect(
    table(page).getByRole('columnheader', { name: /계약단가 \(백만원\)/ }),
  ).toBeVisible();
  await expect(itemIds(page)).toHaveCount(50);
  await expect(itemIds(page).first()).toHaveText(`${PREFIX}A001`);
  const ours = table(page).locator('tbody tr').first();
  await expect(ours).toHaveClass(/bg-accent-ours\/8/);
  await expect(ours.getByText('자사')).toBeVisible();
  await expect(ours.locator('td').nth(6)).toHaveText('123.5');

  await page
    .getByRole('navigation', { name: '페이지' })
    .getByRole('link', { name: '다음' })
    .click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(itemIds(page)).toHaveCount(FILLER_COUNT + 3 - 50);
  await page.goBack();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(itemIds(page)).toHaveCount(50);
});

test('제조사 고정 필드 체크 → URL(replace)·서버 필터, 딥링크로 같은 결과, 정렬 헤더(push) 후 뒤로 가기', async ({
  page,
}) => {
  await bar(page)
    .getByRole('button', { name: /^제조사 필터/ })
    .click();
  const dialog = page.getByRole('dialog', { name: '제조사 필터' });
  await dialog.getByRole('checkbox', { name: '가상보안E2E' }).check();
  await expect(page).toHaveURL(/f\.manufacturer\.in=/);
  await page.keyboard.press('Escape');
  await expect(itemIds(page)).toHaveText([`${PREFIX}A002`]);

  const filtered = page.url();
  await page.goto(filtered);
  await expect(itemIds(page)).toHaveText([`${PREFIX}A002`]);

  await page.goto('/procurement/items?f.product.in=WAPPLES,D.AMO');
  await expect(itemIds(page)).toHaveCount(3);
  await table(page)
    .getByRole('button', { name: /^계약단가/ })
    .click();
  await expect(page).toHaveURL(/sort=unitPrice&dir=asc$/);
  await expect(itemIds(page)).toHaveText([`${PREFIX}A002`, `${PREFIX}A001`, `${PREFIX}A003`]);
  await page.goBack();
  await expect(page).not.toHaveURL(/sort=/);
});

test('계약단가 슬라이더(로그 눈금): 하한 End = 실제 최대 → f.unitPrice.gte(원)', async ({
  page,
}) => {
  await bar(page)
    .getByRole('button', { name: /^＋ \d+개 더$/ })
    .click();
  await page
    .getByRole('dialog', { name: '필터 더 보기' })
    .getByRole('button', { name: '계약단가' })
    .click();
  const dialog = page.getByRole('dialog', { name: '계약단가 필터' });
  const lower = dialog.getByRole('slider', { name: '계약단가 최소' });
  await expect(lower).toHaveAttribute('aria-valuetext', '제한 없음');
  await lower.focus();
  await page.keyboard.press('End');
  await expect(page).toHaveURL(/f\.unitPrice\.gte=\d+/, { timeout: 5_000 });
  const gte = Number(new URL(page.url()).searchParams.get('f.unitPrice.gte'));
  expect(gte).toBeGreaterThanOrEqual(250 * M);
  await page.keyboard.press('Escape');
  await expect(itemIds(page)).toContainText([`${PREFIX}A003`]);
});

test('xlsx 내려받기 = 현재 필터 결과, 계약단가는 원 단위', async ({ page }) => {
  await page.goto('/procurement/items?f.product.in=WAPPLES&sort=itemId&dir=asc');
  await expect(itemIds(page)).toHaveCount(2);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'xlsx 내려받기' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^procurement-items-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const [sheet] = await readXlsxFile(await readFile((await download.path())!));
  const rows = (sheet!.data as unknown[][]).filter((row) => String(row[4]).startsWith(PREFIX));
  expect(rows.map((row) => [row[4], row[6]])).toEqual([
    [`${PREFIX}A001`, 123_456_789],
    [`${PREFIX}A002`, 4 * M],
  ]);
});

test('320px: 페이지 가로 스크롤 없음 — 표는 표 상자 안에서만 스크롤', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/procurement/items');
  await expect(itemIds(page).first()).toBeVisible();
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  // 표는 표 상자 안의 가로 스크롤 컨테이너(DataTable 자체 래퍼)에서 스크롤 — 표에서 가장 가까운 스크롤 조상을 잰다
  const inner = await page
    .locator('[data-procurement-items-scroll] table')
    .first()
    .evaluate((table) => {
      let node = table.parentElement;
      while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) {
        node = node.parentElement;
      }
      return node ? { scroll: node.scrollWidth, client: node.clientWidth } : null;
    });
  expect(inner).not.toBeNull();
  expect(inner!.scroll).toBeGreaterThan(inner!.client);
});
