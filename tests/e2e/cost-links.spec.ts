import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 원가 매핑 관리 (스펙 cost-ratio-price-change §2.1) — /admin/costs/links.
 *
 * 픽스처: globalSetup 의 items-v1(품목 마스터)에는 WAPPLES H/W 본품 `P10100029 Wapples-2400 (H2400 T1)`·
 * `P10100030 Wapples-4000 (H4000 T1)` 이 있지만, costs-dup 원가표에는 같은 모델의 자재가 없다(WAPPLES-100 T4 뿐 —
 * 그 모델의 가격 품목은 S/W 업그레이드라 제안 대상이 아님). 그래서 이 스펙이 같은 모델의 원가 자재 2행(수동, 표준구매원가·일반)을
 * 직접 넣고 끝나면 지운다. 매핑(cost_item_links)도 손댄 품목코드만 전후로 지워 새 DB·재실행 모두 같은 상태에서 시작한다.
 */
test.describe.configure({ mode: 'serial' });

const LINKS_PATH = '/admin/costs/links';

const ITEM_2400 = { code: 'P10100029', name: 'Wapples-2400 (H2400 T1)' };
const ITEM_4000 = { code: 'P10100030', name: 'Wapples-4000 (H4000 T1)' };
const MATERIAL_2400 = { code: 'WE2E2400', name: 'WAPPLES-2400 T1 (E2E)', unitCost: '7654321.00' };
const MATERIAL_4000 = { code: 'WE2E4000', name: 'WAPPLES-4000 T1 (E2E)', unitCost: '8765432.00' };
const ITEM_CODES = [ITEM_2400.code, ITEM_4000.code];
const MATERIALS = [MATERIAL_2400, MATERIAL_4000];

const label = (material: { code: string; name: string }) => `${material.name} (${material.code})`;

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
  await client.query(`delete from cost_item_links where item_code = any($1)`, [ITEM_CODES]);
  await client.query(`delete from material_costs where material_code = any($1)`, [
    MATERIALS.map((material) => material.code),
  ]);
}

test.beforeAll(async () => {
  await withDb(async (client) => {
    // 픽스처 전제가 깨지면 화면 실패 대신 원인을 바로 알린다
    const { rows } = await client.query<{ item_code: string }>(
      `select item_code from items where item_code = any($1) and item_kind = '본품'`,
      [ITEM_CODES],
    );
    expect(rows.map((row) => row.item_code).sort(), 'items-v1 의 WAPPLES H/W 본품 2건').toEqual(
      [...ITEM_CODES].sort(),
    );
    await cleanUp(client);
    for (const material of MATERIALS) {
      await client.query(
        `insert into material_costs (
           material_code, material_name, unit, price_type, price_category, currency, unit_cost,
           effective_from, is_final_source, applies_to_all_customers, source, is_latest_in_series,
           operation_status, product_family)
         values ($1, $2, 'EA', '표준구매원가', '일반', 'KRW', $3, '2026-01-01', true, false, 'manual', true,
           '운영중', 'WAPPLES')`,
        [material.code, material.name, material.unitCost],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

const candidates = (page: Page) => page.getByRole('table', { name: '원가 매핑 후보' });
const rowOf = (page: Page, itemCode: string) =>
  candidates(page).locator('tbody tr').filter({ hasText: itemCode });
/** 기본 열 순서(선택·품목코드·품목명·소분류·상태·정상판매·확정 원가·제안·동작)에서 확정 원가 칸 */
const linkCell = (page: Page, itemCode: string) => rowOf(page, itemCode).locator('td').nth(6);

test('ADMIN: 원가 관리 → 원가 매핑 → 제안대로 확정(새로고침 유지) → 해제', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs');
  await page.getByRole('link', { name: '원가 매핑', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === LINKS_PATH);
  await expect(page.getByRole('heading', { level: 1, name: '원가 매핑' })).toBeVisible();
  await expect(candidates(page)).toBeVisible();
  await expect(page.getByText(/후보 \d+ · 확정 \d+ · 제안 [1-9]\d*/)).toBeVisible();

  const row = rowOf(page, ITEM_2400.code);
  await expect(row).toContainText(label(MATERIAL_2400)); // 제안 칸
  await expect(linkCell(page, ITEM_2400.code)).toHaveText('미확정');

  await row.getByRole('button', { name: `${ITEM_2400.name} 제안대로 확정` }).click();
  await expect(page.getByRole('status').filter({ hasText: '1건 확정' })).toBeVisible();
  await expect(linkCell(page, ITEM_2400.code)).toHaveText(label(MATERIAL_2400));
  await expect(row.getByRole('button', { name: /제안대로 확정/ })).toHaveCount(0);

  await page.reload();
  await expect(linkCell(page, ITEM_2400.code)).toHaveText(label(MATERIAL_2400));

  await rowOf(page, ITEM_2400.code)
    .getByRole('button', { name: `${ITEM_2400.name} 해제` })
    .click();
  const dialog = page.getByRole('dialog', { name: '매핑 해제' });
  await dialog.getByRole('button', { name: '해제' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1건 해제' })).toBeVisible();
  await expect(linkCell(page, ITEM_2400.code)).toHaveText('미확정');
  await page.reload();
  await expect(linkCell(page, ITEM_2400.code)).toHaveText('미확정');

  // 확정·해제 모두 감사에 남는다 (금액 없이 자재번호만)
  await page.goto('/admin/audit?action=cost_link.upsert');
  await expect(
    page
      .getByRole('table', { name: '감사 로그' })
      .getByRole('row')
      .filter({ hasText: ITEM_2400.code })
      .first(),
  ).toContainText(MATERIAL_2400.code);
  await page.goto('/admin/audit?action=cost_link.delete');
  await expect(
    page
      .getByRole('table', { name: '감사 로그' })
      .getByRole('row')
      .filter({ hasText: ITEM_2400.code })
      .first(),
  ).toContainText('성공');
});

test('ADMIN: 두 행 선택 → 선택 2건 제안대로 확정', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, LINKS_PATH);
  const bulk = page.getByRole('button', { name: /^선택 \d+건 제안대로 확정$/ });
  await expect(bulk).toBeDisabled();

  await page.getByRole('checkbox', { name: `${ITEM_2400.name} 선택` }).check();
  await page.getByRole('checkbox', { name: `${ITEM_4000.name} 선택` }).check();
  await page.getByRole('button', { name: '선택 2건 제안대로 확정' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2건 확정' })).toBeVisible();

  await page.reload();
  await expect(linkCell(page, ITEM_2400.code)).toHaveText(label(MATERIAL_2400));
  await expect(linkCell(page, ITEM_4000.code)).toHaveText(label(MATERIAL_4000));
  // 이미 제안과 같은 자재로 확정된 행은 다시 선택할 수 없다
  await expect(page.getByRole('checkbox', { name: `${ITEM_2400.name} 선택` })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `${ITEM_4000.name} 선택` })).toHaveCount(0);

  await withDb(async (client) => {
    const { rows } = await client.query<{ item_code: string; material_code: string }>(
      `select item_code, material_code from cost_item_links where item_code = any($1) order by item_code`,
      [ITEM_CODES],
    );
    expect(rows).toEqual([
      { item_code: ITEM_2400.code, material_code: MATERIAL_2400.code },
      { item_code: ITEM_4000.code, material_code: MATERIAL_4000.code },
    ]);
  });
});

test('ADMIN: 화면 어디에도 원가 금액이 없다', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, LINKS_PATH);
  await expect(candidates(page)).toBeVisible();
  const text = await page.locator('main').innerText();
  for (const material of MATERIALS) {
    const amount = Number(material.unitCost);
    expect(text).not.toContain(String(amount));
    expect(text).not.toContain(amount.toLocaleString('ko-KR'));
  }
  // 픽스처 원가(984,000 · 300,000 등)를 포함한 "숫자,숫자 원" 꼴이 표에 없다
  expect(await candidates(page).innerText()).not.toMatch(/\d{1,3}(,\d{3})+\s*원|₩/);

  const html = await (await page.request.get(LINKS_PATH)).text();
  for (const material of MATERIALS) expect(html).not.toContain(material.unitCost);
});

test('USER: /admin/costs/links → / 리다이렉트, 응답에 자재번호가 없다 (§4.7.1)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing');

  const response = await page.request.get(LINKS_PATH, { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  const body = await response.text();
  for (const forbidden of ['materialCode', '자재번호', ...MATERIALS.map((m) => m.code)]) {
    expect(body).not.toContain(forbidden);
  }

  await page.goto(LINKS_PATH);
  await expect(page).toHaveURL((url) => url.pathname === '/');
  const html = await page.content();
  for (const forbidden of ['materialCode', ...MATERIALS.map((m) => m.code)]) {
    expect(html).not.toContain(forbidden);
  }
  await expect(page.getByRole('table', { name: '원가 매핑 후보' })).toHaveCount(0);
});
