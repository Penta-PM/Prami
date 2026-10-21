import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 원가 비중·가격 변동 열 (스펙 cost-ratio-price-change §2.2~§2.4, PR-2).
 *
 * 픽스처: globalSetup 의 sales-200(판매단가) + items-v1(품목 마스터)에서 WAPPLES H/W 본품(매핑 후보)의 정상판매·KRW·단가>0
 * 행을 가진 품목 2개를 고른다. costs-dup 원가표에는 그 모델 원가가 없으므로 이 스펙이 직접 넣는다:
 * - 품목 A → 자재 WE2ERATIO1 (2000-01-01 부터, 기간 끝 없음) → A 의 모든 KRW 정상판매 행에 비중이 나온다
 * - 품목 B → 자재 WE2ERATIO2 (B 의 마지막 정상판매 적용시작일 다음 날부터) → '—' + "해당 시기 원가 없음"
 * 매핑·원가 행은 전후로 지운다(재실행 안전). workers 1 · serial 이라 다른 스펙과 겹치지 않는다.
 */
test.describe.configure({ mode: 'serial' });

const MATERIAL_A = 'WE2ERATIO1';
const MATERIAL_B = 'WE2ERATIO2';
const COST_FROM_A = '2000-01-01';
const NO_COST_TITLE = '해당 시기 원가 없음';

type Target = { itemCode: string; unitPrice: number; effectiveFrom: string };

/** 테스트 실행 시 beforeAll 이 채운다 */
const fixture = {
  a: null as Target | null,
  b: null as Target | null,
  unitCostA: 0,
  /** A 의 대상 행(unitPrice)에 대한 예상 비중 표기 `NN.N%` */
  expectedLabel: '',
};

/** 서버(price-ratio.ts roundHalfUp1)와 같은 반올림 */
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
  await client.query(`delete from cost_item_links where material_code = any($1)`, [
    [MATERIAL_A, MATERIAL_B],
  ]);
  await client.query(`delete from material_costs where material_code = any($1)`, [
    [MATERIAL_A, MATERIAL_B],
  ]);
}

async function insertCost(client: pg.Client, code: string, unitCost: number, from: string) {
  await client.query(
    `insert into material_costs (
       material_code, material_name, unit, price_type, price_category, currency, unit_cost,
       effective_from, is_final_source, applies_to_all_customers, source, is_latest_in_series,
       operation_status, product_family)
     values ($1, $2, 'EA', '표준구매원가', '일반', 'KRW', $3, $4, true, false, 'manual', true,
       '운영중', 'WAPPLES')`,
    [code, `WAPPLES E2E 비중 ${code}`, unitCost.toFixed(2), from],
  );
}

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    // WAPPLES H/W 본품(매핑 후보) 중 정상판매·KRW·단가>0 행이 있는 품목 — 품목마다 가장 최근 행
    const { rows } = await client.query<{
      item_code: string;
      unit_price: string;
      effective_from: string;
      last_from: string;
    }>(
      `select distinct on (sp.item_code)
              sp.item_code, sp.unit_price::text as unit_price, sp.effective_from::text as effective_from,
              (max(sp.effective_from) over (partition by sp.item_code))::text as last_from
       from sales_prices sp
       join items i on i.item_code = sp.item_code
       where sp.deleted_at is null and sp.price_type = '정상판매' and sp.currency = 'KRW'
         and sp.unit_price > 0 and i.item_kind = '본품' and i.category_major = 'WAPPLES'
         and (i.category_mid = 'H/W Appliance' or i.category_minor = 'H/W Appliance')
       order by sp.item_code, sp.effective_from desc`,
    );
    if (rows.length < 2) {
      throw new Error(
        `E2E 픽스처 전제 실패: WAPPLES H/W 본품의 정상판매·KRW·단가>0 판매단가 행이 있는 품목이 2개 이상 필요합니다 (발견 ${rows.length}개). ` +
          'globalSetup 의 sales-200.xlsx·items-v1.xlsx 적용을 확인하세요.',
      );
    }
    // 같은 품목에 다른(비KRW) 정상판매 행이 있어도 원가가 KRW 뿐이라 '—' 가 될 뿐 — 대상 행은 KRW 로 고른다
    const [a, b] = rows as [(typeof rows)[number], (typeof rows)[number]];
    fixture.a = {
      itemCode: a.item_code,
      unitPrice: Number(a.unit_price),
      effectiveFrom: a.effective_from,
    };
    fixture.b = {
      itemCode: b.item_code,
      unitPrice: Number(b.unit_price),
      effectiveFrom: b.effective_from,
    };
    // 판매가의 약 1/4 + 홀수 오프셋 — 화면의 다른 가격과 우연히 같은 숫자가 되지 않게
    fixture.unitCostA = Math.floor(fixture.a.unitPrice / 4) + 7;
    fixture.expectedLabel = `${roundHalfUp1((fixture.unitCostA / fixture.a.unitPrice) * 100).toFixed(1)}%`;

    await insertCost(client, MATERIAL_A, fixture.unitCostA, COST_FROM_A);
    // B: 마지막 정상판매 적용시작일 다음 날부터 — B 의 모든 정상판매 행이 '해당 시기 원가 없음'
    const { rows: next } = await client.query<{ day: string }>(
      `select ($1::date + 1)::text as day`,
      [b.last_from],
    );
    await insertCost(client, MATERIAL_B, fixture.unitCostA + 1, next[0]!.day);
    // 다른 스펙이 남긴 매핑이 있으면 PK 충돌 — 이 두 품목의 매핑을 비우고 시작한다
    await client.query(`delete from cost_item_links where item_code = any($1)`, [
      [a.item_code, b.item_code],
    ]);
    await client.query(
      `insert into cost_item_links (item_code, material_code) values ($1, $2), ($3, $4)`,
      [a.item_code, MATERIAL_A, b.item_code, MATERIAL_B],
    );
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

const target = () => {
  if (!fixture.a || !fixture.b) throw new Error('beforeAll 픽스처가 준비되지 않았습니다');
  return { a: fixture.a, b: fixture.b };
};

const ADMIN_TABLE = '가격정책 관리 표';
const VIEW_TABLE = '가격정책 표';

const headerTexts = async (page: Page, name: string) =>
  (await page.getByRole('table', { name }).locator('thead th').allInnerTexts()).map((text) =>
    text.trim(),
  );

const PRICE_CHANGE = /^(▲\s?이전 대비 \d+\.\d% 상승|▼\s?이전 대비 \d+\.\d% 하락|변동 없음|—)$/;

async function expectPriceChangeCells(page: Page, name: string) {
  const headers = await headerTexts(page, name);
  const index = headers.indexOf('가격 변동');
  expect(index, '가격 변동 열').toBeGreaterThanOrEqual(0);
  const cells = await page
    .getByRole('table', { name })
    .locator(`tbody tr td:nth-child(${index + 1})`)
    .allInnerTexts();
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) expect(cell.trim()).toMatch(PRICE_CHANGE);
  return headers;
}

/** 원가 금액이 원문(소수 2자리)·정수·천단위 쉼표 어느 형태로도 없어야 한다 */
function expectNoAmount(text: string, amount: number) {
  expect(text).not.toContain(amount.toFixed(2));
  expect(text).not.toContain(amount.toLocaleString('ko-KR'));
  expect(text).not.toMatch(new RegExp(`(?<![\\d.,])${amount}(?![\\d.,])`));
}

test('ADMIN: 원가 비중 열 — 판매가 → 원가 매핑 뒤, NN.N% + 원가 적용일 툴팁, 해당 시기 원가 없음 사유', async ({
  page,
}) => {
  const { a, b } = target();
  await loginAs(page, FIXTURE_ADMIN, `/admin/policies?q=${a.itemCode}`);
  const table = page.getByRole('table', { name: ADMIN_TABLE });
  await expect(table).toBeVisible();

  const headers = await headerTexts(page, ADMIN_TABLE);
  // 판매가 → 원가 매핑 → 원가 비중 (policy-cost-link-column §2.1-1)
  expect(headers.indexOf('원가 비중')).toBe(headers.indexOf('판매가') + 2);

  const ratio = table
    .locator(`span[title="원가 적용일 ${COST_FROM_A}"]`)
    .filter({ hasText: fixture.expectedLabel });
  await expect(ratio.first()).toBeVisible();
  // has 는 행 기준 상대 위치로 찾으므로 page 루트 로케이터로 넘긴다(table 루트면 행 안에서 매칭되지 않음)
  const ratioInRow = page
    .locator(`span[title="원가 적용일 ${COST_FROM_A}"]`)
    .filter({ hasText: fixture.expectedLabel });
  await expect(table.locator('tbody tr').filter({ has: ratioInRow }).first()).toContainText(
    '정상판매',
  );

  // 정렬 불가: 헤더 클릭은 URL 을 바꾸지 않고 aria-sort 도 없다
  const url = page.url();
  const costHeader = table.locator('thead th').filter({ hasText: '원가 비중' });
  await costHeader.click();
  await expect(page).toHaveURL(url);
  await expect(costHeader).not.toHaveAttribute('aria-sort', /.+/);

  await page.goto(`/admin/policies?q=${b.itemCode}`);
  const noCost = table.locator(`span[title="${NO_COST_TITLE}"]`);
  await expect(noCost.first()).toBeAttached();
  await expect(noCost.first()).toContainText('—');
});

test('ADMIN: sort=costRatio 는 화이트리스트 밖 — 기본 순서와 같고 aria-sort 없음', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  const table = page.getByRole('table', { name: ADMIN_TABLE });
  await expect(table).toBeVisible();
  const defaultRows = await table.locator('tbody tr').allInnerTexts();

  await page.goto('/admin/policies?sort=costRatio&dir=desc');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th[aria-sort]')).toHaveCount(0);
  expect(await table.locator('tbody tr').allInnerTexts()).toEqual(defaultRows);
});

test('ADMIN: 가격 변동 열 — 운영 연도 뒤, 상승·하락·변동 없음·— 표기', async ({ page }) => {
  const { a } = target();
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  const headers = await expectPriceChangeCells(page, ADMIN_TABLE);
  expect(headers.indexOf('가격 변동')).toBe(headers.indexOf('운영 연도') + 1);

  await page.goto(`/admin/policies?q=${a.itemCode}`);
  await expectPriceChangeCells(page, ADMIN_TABLE);
});

test('ADMIN: 관리 화면 어디에도 원가 금액이 없다', async ({ page }) => {
  const { a } = target();
  await loginAs(page, FIXTURE_ADMIN, `/admin/policies?q=${a.itemCode}`);
  await expect(page.getByRole('table', { name: ADMIN_TABLE })).toBeVisible();
  expectNoAmount(await page.locator('main').innerText(), fixture.unitCostA);

  const html = await (await page.request.get(`/admin/policies?q=${a.itemCode}`)).text();
  expectNoAmount(html, fixture.unitCostA);
  const rsc = await (
    await page.request.get(`/admin/policies?q=${a.itemCode}&_rsc=1`, { headers: { RSC: '1' } })
  ).text();
  expectNoAmount(rsc, fixture.unitCostA);
});

test('USER: /pricing — 원가 비중·가격 변동 열 없음, HTML·RSC 에 costRatio·원가·비중·가격 변동 키 없음', async ({
  page,
}) => {
  const { a } = target();
  const path = `/pricing?q=${a.itemCode}`;
  await loginAs(page, FIXTURE_USER, path);
  await expect(page.getByRole('table', { name: VIEW_TABLE })).toBeVisible();

  const headers = await headerTexts(page, VIEW_TABLE);
  expect(headers).not.toContain('원가 비중');
  // 조회 화면은 가격 변동 비노출 (pricing-view-hide-price-change §2)
  expect(headers).not.toContain('가격 변동');
  await expect(
    page.getByRole('table', { name: VIEW_TABLE }).locator('[data-price-change]'),
  ).toHaveCount(0);

  // 비중 표기 — 가격 변동 문구("이전 대비 N.N% …")와 구분한다
  const ratioText = new RegExp(`(?<!이전 대비 )${fixture.expectedLabel.replace('.', '\\.')}`);
  const html = await (await page.request.get(path)).text();
  const rsc = await (await page.request.get(`${path}&_rsc=1`, { headers: { RSC: '1' } })).text();
  for (const body of [html, rsc]) {
    expect(body).not.toContain('costRatio');
    expect(body).not.toContain('costLink');
    expect(body).not.toMatch(/previousPrice|priceChangeRate/);
    expect(body).not.toContain('원가 적용일');
    expect(body).not.toMatch(ratioText);
    expectNoAmount(body, fixture.unitCostA);
  }
});
