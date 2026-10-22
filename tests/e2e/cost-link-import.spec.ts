import { expect, test } from '@playwright/test';
import pg from 'pg';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * 품목-원가 매칭 파일 업로드 (스펙 erp-upload-guide §6.2) — /admin/costs/links.
 *
 * 기밀: 실제 매칭 파일·내용을 쓰지 않는다. 실행 중에 합성 xlsx 를 메모리에서 만든다(디스크에 남기지 않음).
 * 품목은 globalSetup 픽스처(items-v1·sales-200)의 WAPPLES H/W 본품 중 정상판매·KRW·단가>0 행이 있는 품목을 실행 시 고르고
 * (cost-ratio 스펙과 겹치지 않게 마지막 품목), 원가 자재는 합성 번호 TEST-MAT-E2E-001 을 이 스펙이 넣고 지운다.
 * 그 품목의 기존 매핑은 저장했다가 끝나면 되돌린다(재실행 안전).
 */
test.describe.configure({ mode: 'serial' });

const MATERIAL = 'TEST-MAT-E2E-001';
const COST_FROM = '2000-01-01';
const MISSING_ITEM = 'TEST-ITEM-E2E-404';

const fixture = {
  itemCode: '',
  unitPrice: 0,
  unitCost: 0,
  previous: null as string | null,
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

/** 합성 매칭 파일: 1행 제목, 2행 헤더(무시 열 포함), 3행부터 데이터 */
async function matchingXlsx(rows: (string | null)[][], title = '품목조회(추가정보)') {
  const data: SheetData = [
    [title],
    ['품명', '품번', '원자재품번(필수)', '원자재대체품번'],
    ...rows,
  ].map((row) => row.map((value) => (value ?? null) as Cell));
  return writeXlsxFile(data, { sheet: 'Sheet1' }).toBuffer();
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
       order by sp.item_code desc, sp.effective_from desc`,
    );
    if (rows.length === 0) {
      throw new Error(
        'E2E 픽스처 전제 실패: WAPPLES H/W 본품의 정상판매·KRW·단가>0 판매단가 행이 있는 품목이 필요합니다. ' +
          'globalSetup 의 sales-200.xlsx·items-v1.xlsx 적용을 확인하세요.',
      );
    }
    fixture.itemCode = rows[0]!.item_code;
    fixture.unitPrice = Number(rows[0]!.unit_price);
    fixture.unitCost = Math.floor(fixture.unitPrice / 4) + 11;
    fixture.expectedLabel = `${roundHalfUp1((fixture.unitCost / fixture.unitPrice) * 100).toFixed(1)}%`;
    const { rows: links } = await client.query<{ material_code: string }>(
      `select material_code from cost_item_links where item_code = $1`,
      [fixture.itemCode],
    );
    fixture.previous = links[0]?.material_code ?? null;
    await client.query(`delete from cost_item_links where item_code = $1`, [fixture.itemCode]);
    await client.query(
      `insert into material_costs (
         material_code, material_name, unit, price_type, price_category, currency, unit_cost,
         effective_from, is_final_source, applies_to_all_customers, source, is_latest_in_series,
         operation_status, product_family)
       values ($1, 'TEST 자재 E2E', 'EA', '표준구매원가', '일반', 'KRW', $2, $3, true, false, 'manual',
         true, '운영중', 'WAPPLES')`,
      [MATERIAL, fixture.unitCost.toFixed(2), COST_FROM],
    );
  });
});

test.afterAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    if (fixture.itemCode && fixture.previous) {
      await client.query(
        `insert into cost_item_links (item_code, material_code) values ($1, $2)
         on conflict (item_code) do update set material_code = excluded.material_code`,
        [fixture.itemCode, fixture.previous],
      );
    }
  });
});

test('ADMIN: 합성 매칭 파일 → 미리보기 → 확정(추가 1) → 가격정책 관리 원가 비중 갱신', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs/links');
  const input = page.getByLabel('품목-원가 매칭 파일 선택');

  // 반대 방향 오업로드: 필수 헤더 없는 일반 품목조회 모양 → 형식 거부
  const plain = await writeXlsxFile(
    [['품목조회'], ['품명', '품번', '품목 상태'], ['TEST 품목', MISSING_ITEM, '사용']] as SheetData,
    { sheet: 'Sheet1' },
  ).toBuffer();
  await input.setInputFiles({
    name: 'synthetic-plain.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: plain,
  });
  await expect(
    page.getByRole('alert').filter({ hasText: '품목-원가 매칭 파일 형식이 아닙니다' }),
  ).toBeVisible();

  const buffer = await matchingXlsx([
    ['TEST 품목 1', fixture.itemCode, MATERIAL, null],
    ['TEST 품목 2', MISSING_ITEM, MATERIAL, null],
    ['TEST 품목 3', 'TEST-ITEM-E2E-002', null, null],
  ]);
  await input.setInputFiles({
    name: 'synthetic-matching.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  const preview = page.getByRole('group', { name: '매칭 파일 미리보기' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('파일 3행');
  await expect(preview).toContainText('건너뜀 1행');
  await expect(preview).toContainText('추가 1');
  await expect(preview).toContainText('실패 1');
  await expect(preview).toContainText('품목 마스터 없음 1');
  await preview.getByText('추가 1건 보기').click();
  await expect(preview).toContainText(fixture.itemCode);

  await preview.getByRole('button', { name: '확정(변경 0·추가 1)' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1건 확정' })).toBeVisible();
  await expect(preview).toHaveCount(0);

  const saved = await withDb((client) =>
    client.query<{ material_code: string }>(
      `select material_code from cost_item_links where item_code = $1`,
      [fixture.itemCode],
    ),
  );
  expect(saved.rows.map((row) => row.material_code)).toEqual([MATERIAL]);

  // 가격정책 관리 표: 같은 매핑으로 원가 비중이 계산된다
  await page.goto(`/admin/policies?q=${fixture.itemCode}`);
  const table = page.getByRole('table', { name: '가격정책 관리 표' });
  await expect(table).toBeVisible();
  await expect(
    table
      .locator(`span[title="원가 적용일 ${COST_FROM}"]`)
      .filter({
        hasText: fixture.expectedLabel,
      })
      .first(),
  ).toBeVisible();
});
