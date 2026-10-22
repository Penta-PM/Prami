import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 가격정책 관리 — 원가 매핑 열 + 매핑 수정 모달 (스펙 policy-cost-link-column §2.1·§2.3·§4).
 *
 * 픽스처: globalSetup 의 sales-200 + items-v1 에서 WAPPLES H/W 본품(매핑 후보)의 정상판매·KRW·단가>0 행을 가진 품목 하나를
 * 고른다(cost-ratio.spec 과 겹치지 않게 목록의 마지막 품목). 이 스펙이 원가 자재 WE2ELINK1(2000-01-01 부터)을 넣고, 그 품목의
 * 매핑을 비운 채 시작한다 → 관리 화면 칸에서 매핑 → 같은 화면 원가 비중 % → 해제 → '—'. 전후로 지운다(재실행 안전).
 */
test.describe.configure({ mode: 'serial' });

const MATERIAL = 'WE2ELINK1';
const COST_FROM = '2000-01-01';
const ADMIN_TABLE = '가격정책 관리 표';
const VIEW_TABLE = '가격정책 표';

const fixture = {
  itemCode: '',
  unitPrice: 0,
  unitCost: 0,
  priceRows: 0,
  expectedLabel: '',
};

const roundHalfUp1 = (value: number) => Math.floor(value * 10 + 0.5 + 1e-9) / 10;

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
  await client.query(`delete from cost_item_links where material_code = $1`, [MATERIAL]);
  await client.query(`delete from material_costs where material_code = $1`, [MATERIAL]);
}

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    const { rows } = await client.query<{ item_code: string; unit_price: string }>(
      `select distinct on (sp.item_code) sp.item_code, sp.unit_price::text as unit_price
       from sales_prices sp
       join items i on i.item_code = sp.item_code
       where sp.deleted_at is null and sp.price_type = '정상판매' and sp.currency = 'KRW'
         and sp.unit_price > 0 and i.item_kind = '본품' and i.category_major = 'WAPPLES'
         and (i.category_mid = 'H/W Appliance' or i.category_minor = 'H/W Appliance')
       order by sp.item_code, sp.effective_from desc`,
    );
    const target = rows.at(-1);
    if (!target) {
      throw new Error(
        'E2E 픽스처 전제 실패: WAPPLES H/W 본품의 정상판매·KRW·단가>0 판매단가 행이 있는 품목이 필요합니다. ' +
          'globalSetup 의 sales-200.xlsx·items-v1.xlsx 적용을 확인하세요.',
      );
    }
    fixture.itemCode = target.item_code;
    fixture.unitPrice = Number(target.unit_price);
    fixture.unitCost = Math.floor(fixture.unitPrice / 3) + 11;
    fixture.expectedLabel = `${roundHalfUp1((fixture.unitCost / fixture.unitPrice) * 100).toFixed(1)}%`;
    const { rows: count } = await client.query<{ n: number }>(
      `select count(*)::int as n from sales_prices where item_code = $1 and deleted_at is null`,
      [target.item_code],
    );
    fixture.priceRows = count[0]!.n;
    await client.query(
      `insert into material_costs (
         material_code, material_name, unit, price_type, price_category, currency, unit_cost,
         effective_from, is_final_source, applies_to_all_customers, source, is_latest_in_series,
         operation_status, product_family)
       values ($1, 'WAPPLES E2E 매핑 열', 'EA', '표준구매원가', '일반', 'KRW', $2, $3, true, false,
         'manual', true, '운영중', 'WAPPLES')`,
      [MATERIAL, fixture.unitCost.toFixed(2), COST_FROM],
    );
    await client.query(`delete from cost_item_links where item_code = $1`, [target.item_code]);
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

const headerTexts = async (page: Page, name: string) =>
  (await page.getByRole('table', { name }).locator('thead th').allInnerTexts()).map((text) =>
    text.trim(),
  );

/** 열 이름으로 첫 정상판매 행의 칸 */
async function normalRowCell(page: Page, header: string) {
  const index = (await headerTexts(page, ADMIN_TABLE)).indexOf(header);
  expect(index, header).toBeGreaterThanOrEqual(0);
  return page
    .getByRole('table', { name: ADMIN_TABLE })
    .locator('tbody tr')
    .filter({ hasText: '정상판매' })
    .first()
    .locator('td')
    .nth(index);
}

const modal = (page: Page) => page.getByRole('dialog', { name: '원가 매핑' });

test('ADMIN: 칸 클릭 → 모달 → 자재 확정 → 모달 닫힘·안내·포커스 복귀, 같은 화면 원가 매핑·원가 비중 갱신(감사 1건)', async ({
  page,
}) => {
  const upserts = () =>
    withDb(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from audit_logs where action = 'cost_link.upsert' and target_id = $1
           and result = 'success' and after->>'materialCode' = $2`,
        [fixture.itemCode, MATERIAL],
      );
      return rows[0]!.n;
    });
  const auditsBefore = await upserts();
  await loginAs(page, FIXTURE_ADMIN, `/admin/policies?q=${fixture.itemCode}`);
  await expect(page.getByRole('table', { name: ADMIN_TABLE })).toBeVisible();
  const headers = await headerTexts(page, ADMIN_TABLE);
  expect(headers.indexOf('원가 매핑')).toBe(headers.indexOf('원가 비중') - 1);

  const linkCell = await normalRowCell(page, '원가 매핑');
  const ratioCell = await normalRowCell(page, '원가 비중');
  await expect(linkCell).toHaveText('미매핑');
  await expect(ratioCell).toHaveText('—');

  const trigger = linkCell.getByRole('button', { name: /원가 매핑 수정$/ });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await trigger.click();
  await expect(modal(page)).toBeVisible();
  // 칸 클릭은 행 드로어를 열지 않는다
  await expect(page.getByRole('dialog', { name: '행 상세' })).toHaveCount(0);
  await expect(modal(page).getByLabel('품목 요약')).toContainText(fixture.itemCode);
  await expect(modal(page)).toContainText(`이 품목의 가격 행 ${fixture.priceRows}건에`);
  await expect(modal(page).getByRole('link', { name: '매핑 화면에서 보기' })).toHaveAttribute(
    'href',
    '/admin/costs/links',
  );
  expect(await modal(page).innerText()).not.toContain(fixture.unitCost.toLocaleString('ko-KR'));

  await modal(page).getByRole('combobox', { name: '자재명·자재번호 검색' }).fill(MATERIAL);
  await modal(page)
    .getByRole('listbox', { name: /원가 자재/ })
    .getByRole('option', { name: new RegExp(MATERIAL) })
    .click();
  await modal(page).getByRole('button', { name: '확정' }).click();
  await expect(modal(page)).toHaveCount(0);

  await expect(page.locator('[data-cost-link-live]')).toHaveText(
    `${fixture.itemCode} 원가 매핑 변경 — 가격 행 ${fixture.priceRows}건`,
  );
  await expect(linkCell).toContainText(MATERIAL);
  // 원가 비중: 이 품목의 KRW 정상판매 행에 NN.N% + 원가 적용일 (첫 정상판매 행이 다른 화폐면 그 칸은 '—')
  await expect(
    page
      .getByRole('table', { name: ADMIN_TABLE })
      .locator(`span[title="원가 적용일 ${COST_FROM}"]`)
      .filter({ hasText: fixture.expectedLabel })
      .first(),
  ).toBeVisible();
  await expect(linkCell.getByRole('button', { name: /원가 매핑 수정$/ })).toBeFocused();
  // 같은 품목의 모든 가격 행에 같은 값
  const index = (await headerTexts(page, ADMIN_TABLE)).indexOf('원가 매핑');
  for (const text of await page
    .getByRole('table', { name: ADMIN_TABLE })
    .locator(`tbody tr td:nth-child(${index + 1})`)
    .allInnerTexts()) {
    expect(text).toContain(MATERIAL);
  }

  await withDb(async (client) => {
    const { rows } = await client.query<{ material_code: string }>(
      `select material_code from cost_item_links where item_code = $1`,
      [fixture.itemCode],
    );
    expect(rows).toEqual([{ material_code: MATERIAL }]);
  });
  expect(await upserts()).toBe(auditsBefore + 1);
});

test('ADMIN: 매핑 해제 — 2단계 확인 → 원가 매핑 "미매핑"·원가 비중 "—"', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, `/admin/policies?q=${fixture.itemCode}`);
  const linkCell = await normalRowCell(page, '원가 매핑');
  await expect(linkCell).toContainText(MATERIAL);
  const ratios = page
    .getByRole('table', { name: ADMIN_TABLE })
    .locator(`span[title="원가 적용일 ${COST_FROM}"]`);
  await expect(ratios.first()).toBeVisible();

  await linkCell.getByRole('button', { name: /원가 매핑 수정$/ }).click();
  await expect(modal(page).getByRole('button', { name: '확정' })).toBeDisabled();
  await modal(page).getByRole('button', { name: '매핑 해제' }).click();
  await expect(modal(page)).toContainText('의 원가 매핑을 해제합니다');
  await modal(page).getByRole('button', { name: '해제', exact: true }).click();
  await expect(modal(page)).toHaveCount(0);

  await expect(linkCell).toHaveText('미매핑');
  await expect(ratios).toHaveCount(0);
  await withDb(async (client) => {
    const { rows } = await client.query(`select 1 from cost_item_links where item_code = $1`, [
      fixture.itemCode,
    ]);
    expect(rows).toEqual([]);
  });
});

test('ADMIN: sort=costLink·f.costLink.* 는 무시 — 기본 순서, aria-sort 없음, 오류 없음', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  const table = page.getByRole('table', { name: ADMIN_TABLE });
  await expect(table).toBeVisible();
  const defaultRows = await table.locator('tbody tr').allInnerTexts();
  await page.goto('/admin/policies?sort=costLink&dir=desc&f.costLink.in=W1');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th[aria-sort]')).toHaveCount(0);
  expect(await table.locator('tbody tr').allInnerTexts()).toEqual(defaultRows);
});

for (const [role, email] of [
  ['ADMIN', FIXTURE_ADMIN],
  ['USER', FIXTURE_USER],
] as const) {
  test(`${role}: /pricing — 원가 매핑 열·칸 없음, HTML·RSC 에 costLink·자재번호 없음`, async ({
    page,
  }) => {
    const path = `/pricing?q=${fixture.itemCode}`;
    await loginAs(page, email, path);
    await expect(page.getByRole('table', { name: VIEW_TABLE })).toBeVisible();
    expect(await headerTexts(page, VIEW_TABLE)).not.toContain('원가 매핑');
    await expect(page.locator('[data-cost-link-state]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /원가 매핑 수정$/ })).toHaveCount(0);
    const html = await (await page.request.get(path)).text();
    const rsc = await (await page.request.get(`${path}&_rsc=1`, { headers: { RSC: '1' } })).text();
    for (const body of [html, rsc]) {
      expect(body).not.toContain('costLink');
      expect(body).not.toContain('materialCode');
    }
  });
}
