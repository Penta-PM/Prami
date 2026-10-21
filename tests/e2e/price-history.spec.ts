import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 가격 변동 이력 모달 (스펙 price-change-history-modal §2.2~§2.4, §3) — **관리 화면(/admin/policies)만**.
 * 조회 화면(/pricing)은 USER·ADMIN 모두 가격 변동 칸·모달·드로어 계열 이력·"변동 이력 보기"가 없고, HTML·RSC payload·
 * 드로어 액션 응답에 가격 변동·이력 키가 없다 (pricing-view-hide-price-change §2, Q-V1 = B).
 *
 * 픽스처: globalSetup 의 sales-200 에서 **살아 있는 행이 모두 한 계열**이고 그 계열이 2행 이상인 품목 하나를 고른다 —
 * `?q=품번` 으로 거르면 표의 행 = 그 계열 전부(기본 정렬 적용시작일 최신 순)라 첫 행이 최신 시기다.
 * 데이터는 바꾸지 않는다(읽기 전용).
 */
test.describe.configure({ mode: 'serial' });

const VIEW_TABLE = '가격정책 표';
const ADMIN_TABLE = '가격정책 관리 표';
const MODAL = '가격 변동 이력';

type Series = { itemCode: string; ids: number[] };
const fixture = { series: null as Series | null };

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  fixture.series = await withDb(async (client) => {
    const { rows } = await client.query<{ item_code: string; ids: string[] }>(
      `select item_code, array_agg(id::text order by effective_from desc) as ids
         from sales_prices
        where deleted_at is null
        group by item_code
       having count(distinct series_key) = 1 and count(*) >= 2
        order by item_code
        limit 1`,
    );
    const row = rows[0];
    if (!row) throw new Error('픽스처: 한 계열 2행 이상 품목 없음');
    return { itemCode: row.item_code, ids: row.ids.map(Number) };
  });
});

const series = () => fixture.series!;

const modal = (page: Page) => page.getByRole('dialog', { name: MODAL });
const drawer = (page: Page) => page.getByRole('dialog', { name: '행 상세' });
/** 표의 첫 행(최신 시기)의 가격 변동 버튼 */
const firstTrigger = (page: Page, table: string) =>
  page
    .getByRole('table', { name: table })
    .locator('tbody tr')
    .first()
    .getByRole('button', { name: /가격 변동 이력$/ });

async function expectHistoryTable(page: Page, highlightId: number) {
  const table = modal(page).getByRole('table', { name: '가격 변동 이력 표' });
  await expect(table).toBeVisible();
  // 비고 열 = 행별 판매단가 비고(모든 역할), 품목 마스터 비고는 표 열이 아니다 (§6 A)
  await expect(table.locator('thead th')).toHaveText([
    '적용기간',
    '판매가',
    '직전 대비 금액',
    '변동률',
    '운영상태',
    '출처',
    '비고',
  ]);
  const ids = await table
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-row-id'))));
  expect(ids).toEqual(series().ids); // 같은 계열 전부, 최신 순
  await expect(table.locator(`tbody tr[data-row-id="${highlightId}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  // 가장 오래된 행의 직전 대비 금액·변동률 = —
  await expect(table.locator('tbody tr').last().locator('td').nth(2)).toHaveText('—');
}

for (const [role, email] of [
  ['USER', FIXTURE_USER],
  ['ADMIN', FIXTURE_ADMIN],
] as const) {
  test.describe(`${role} /pricing — 가격 변동·이력 비노출`, () => {
    test('헤더·칸 버튼·모달 없음, 드로어에 계열 이력·"변동 이력 보기" 없음, 응답에 키 0', async ({
      page,
    }) => {
      // 드로어를 여는 Server Action 응답 본문 (POST + Next-Action 헤더)
      const actionBodies: Promise<string>[] = [];
      page.on('response', (response) => {
        const request = response.request();
        if (request.method() === 'POST' && request.headers()['next-action'])
          actionBodies.push(response.text());
      });
      const url = `/pricing?q=${series().itemCode}`;
      await loginAs(page, email, url);
      const table = page.getByRole('table', { name: VIEW_TABLE });
      await expect(table).toBeVisible();
      await expect(table.locator('thead th', { hasText: '가격 변동' })).toHaveCount(0);
      await expect(table.locator('[data-price-change]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /가격 변동 이력$/ })).toHaveCount(0);
      // HTML(초기 RSC payload 포함)·RSC 요청 응답에 가격 변동 키 0
      expect(await page.content()).not.toMatch(/previousPrice|priceChangeRate/);
      const rsc = await page.request.get(url, { headers: { RSC: '1' } });
      expect(rsc.ok()).toBe(true);
      expect(await rsc.text()).not.toMatch(/previousPrice|priceChangeRate/);

      await table.locator('tbody tr').first().locator('td').first().click();
      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page).getByRole('region', { name: '원본 20컬럼' })).toBeVisible();
      await expect(drawer(page).getByRole('region', { name: '계열 이력' })).toHaveCount(0);
      await expect(drawer(page).getByRole('button', { name: '변동 이력 보기' })).toHaveCount(0);
      await expect(modal(page)).toHaveCount(0);
      expect(actionBodies.length).toBeGreaterThan(0);
      for (const body of await Promise.all(actionBodies))
        expect(body).not.toMatch(/"history"|previousPrice|priceChangeRate|changeRate/);
    });

    test('`f.priceChange.gte=1&sort=priceChange&dir=desc` → 오류 없이 무시(기본 정렬, 칩 없음)', async ({
      page,
    }) => {
      await loginAs(page, email, `/pricing?q=${series().itemCode}`);
      const table = page.getByRole('table', { name: VIEW_TABLE });
      const defaultRows = await table.locator('tbody tr').allTextContents();
      await page.goto(
        `/pricing?q=${series().itemCode}&f.priceChange.gte=1&sort=priceChange&dir=desc`,
      );
      await expect(table).toBeVisible();
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('list', { name: '적용된 필터' })).toHaveCount(0);
      expect(await table.locator('tbody tr').allTextContents()).toEqual(defaultRows);
    });
  });
}

for (const [role, email, path, tableName] of [
  ['ADMIN', FIXTURE_ADMIN, '/admin/policies', ADMIN_TABLE],
] as const) {
  test.describe(`${role} ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, email, `${path}?q=${series().itemCode}`);
      await expect(page.getByRole('table', { name: tableName })).toBeVisible();
    });

    test('가격 변동 칸 클릭 → 모달(드로어 아님), 최신 순, Esc → 포커스 칸 버튼', async ({
      page,
    }) => {
      const trigger = firstTrigger(page, tableName);
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      await trigger.click();
      await expect(modal(page)).toBeVisible();
      await expect(drawer(page)).toHaveCount(0);
      await expectHistoryTable(page, series().ids[0]!);
      await expect(modal(page).getByLabel('계열 요약')).toContainText(series().itemCode);
      await page.keyboard.press('Escape');
      await expect(modal(page)).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(drawer(page)).toHaveCount(0);
    });

    test('같은 행 다른 칸 클릭 → 드로어', async ({ page }) => {
      await page
        .getByRole('table', { name: tableName })
        .locator('tbody tr')
        .first()
        .locator('td')
        .first()
        .click();
      await expect(drawer(page)).toBeVisible();
      await expect(modal(page)).toHaveCount(0);
    });

    test('드로어 "변동 이력 보기" → 모달이 위에, Esc → 드로어 유지·포커스 버튼', async ({
      page,
    }) => {
      await page
        .getByRole('table', { name: tableName })
        .locator('tbody tr')
        .nth(1)
        .locator('td')
        .first()
        .click();
      await expect(drawer(page)).toBeVisible();
      const open = drawer(page).getByRole('button', { name: '변동 이력 보기' });
      await open.click();
      await expect(modal(page)).toBeVisible();
      await expectHistoryTable(page, series().ids[1]!);
      await page.keyboard.press('Escape');
      await expect(modal(page)).toBeHidden();
      await expect(drawer(page)).toBeVisible();
      await expect(open).toBeFocused();
      // 닫기 버튼으로 다시 열고 닫아도 드로어 유지
      await open.click();
      await expect(modal(page)).toBeVisible();
      await modal(page).getByRole('button', { name: '닫기' }).click();
      await expect(modal(page)).toBeHidden();
      await expect(drawer(page)).toBeVisible();
    });

    test('키보드: 칸 버튼 포커스 후 Enter → 모달', async ({ page }) => {
      const trigger = firstTrigger(page, tableName);
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(modal(page)).toBeVisible();
      await expect(drawer(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Space');
      await expect(modal(page)).toBeVisible();
    });

    test('375px: 모달이 열려도 페이지 가로 스크롤 없음', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      const trigger = firstTrigger(page, tableName);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await expect(modal(page).getByRole('table', { name: '가격 변동 이력 표' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await modal(page).boundingBox();
      expect(box!.width).toBeLessThanOrEqual(375 - 32 + 1);
    });
  });
}
