import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 조달이 통합 UI-6 (조달 관리 · 실적 관리 `/admin/procurement`): 납품요구 표(서버 페이지네이션·빠른 필터·검색), 편집 드로어(전 필드 +
 * 변경 이력) → 확인 모달 → 저장, 휴지통으로·되살리기(확인 모달), 휴지통 하위 화면, 동시 편집 "이미 처리됨", 이력·감사 같은 트랜잭션,
 * USER 접근 차단, 320px 가로 스크롤 없음.
 *
 * E2E DB 에는 조달 데이터가 없다 → 이 스펙이 **합성** 납품요구(가상 요구번호·기관·업체)를 넣고 전후로 지운다(이력 포함).
 * workers 1 · serial 이라 다른 스펙(procurement-shell 의 빈 상태)과 겹치지 않는다.
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = 'E2E-DLV-';
const ITEM_PREFIX = 'E2E-DLV-ITEM-';

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
  await client.query(
    `delete from procurement.delivery_changes where delivery_id in
       (select id from procurement.deliveries where dlvr_req_no like $1)`,
    [`${PREFIX}%`],
  );
  await client.query(`delete from procurement.deliveries where dlvr_req_no like $1`, [
    `${PREFIX}%`,
  ]);
  await client.query(`delete from procurement.items where item_id like $1`, [`${ITEM_PREFIX}%`]);
}

type SyntheticDelivery = {
  no: string;
  item: string;
  date: string;
  org: string;
  vendor: string;
  amount: number;
  excluded?: boolean;
};

const DELIVERIES: SyntheticDelivery[] = [
  {
    no: `${PREFIX}001`,
    item: `${ITEM_PREFIX}1`,
    date: '2026-03-02',
    org: 'E2E 가상 수요기관',
    vendor: 'E2E 가상상사',
    amount: 12_340_000,
  },
  {
    no: `${PREFIX}002`,
    item: `${ITEM_PREFIX}2`,
    date: '2026-02-01',
    org: 'E2E 다른 기관',
    vendor: 'E2E 다른상사',
    amount: 5_000_000,
  },
  {
    no: `${PREFIX}003`,
    item: `${ITEM_PREFIX}1`,
    date: '2026-01-05',
    org: 'E2E 가상 수요기관',
    vendor: 'E2E 가상상사',
    amount: 1_000_000,
    excluded: true,
  },
];

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    await client.query(
      `insert into procurement.items (item_id, product, status, item_name) values ($1, 'WAPPLES', 'active', 'E2E 가상 장비')`,
      [`${ITEM_PREFIX}1`],
    );
    for (const row of DELIVERIES) {
      await client.query(
        `insert into procurement.deliveries
           (dlvr_req_no, item_id, change_ord, dlvr_req_date, demand_org, vendor, item_name, unit_price, quantity, amount, excluded)
         values ($1, $2, '00', $3, $4, $5, 'E2E 가상 장비', $6, 1, $6, $7)`,
        [row.no, row.item, row.date, row.org, row.vendor, row.amount, row.excluded ?? false],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

const deliveriesTable = (page: Page) => page.getByRole('table', { name: '납품요구 표' });
const trashTable = (page: Page) => page.getByRole('table', { name: '휴지통 표' });

async function syntheticRows(client: pg.Client) {
  return (
    await client.query<{ dlvr_req_no: string; amount: string; excluded: boolean; vendor: string }>(
      `select dlvr_req_no, amount::text, excluded, vendor from procurement.deliveries
       where dlvr_req_no like $1 order by dlvr_req_no`,
      [`${PREFIX}%`],
    )
  ).rows;
}

async function changeCount(client: pg.Client, no: string) {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from procurement.delivery_changes c
       join procurement.deliveries d on d.id = c.delivery_id where d.dlvr_req_no = $1`,
    [no],
  );
  return rows[0]?.n ?? 0;
}

async function auditCount(client: pg.Client, action: string, label: string) {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from audit_logs where action = $1 and target_label like $2 and result = 'success'`,
    [action, `${label}%`],
  );
  return rows[0]?.n ?? 0;
}

test('USER 는 조달 관리에 들어갈 수 없다', async ({ page }) => {
  // 다른 관리 화면 테스트(parts·procurement-shell)와 같은 방식: 로그인 뒤 직접 접근 → / 로 이동, 관리 화면은 그려지지 않음
  await loginAs(page, FIXTURE_USER, '/procurement');
  await page.goto('/admin/procurement?tab=deliveries');
  await expect(page).toHaveURL((url) => url.pathname === '/');
  await expect(page.getByRole('heading', { level: 1, name: '조달 관리' })).toHaveCount(0);
});

test.describe('ADMIN', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FIXTURE_ADMIN, '/admin/procurement?tab=deliveries');
    await expect(page.getByRole('heading', { level: 1, name: '조달 관리' })).toBeVisible();
  });

  test('납품요구 표: 합성 행·백만원 머리글·제품(등록 물품)·검색', async ({ page }) => {
    const table = deliveriesTable(page);
    await expect(table.getByRole('columnheader', { name: /납품금액 \(백만원\)/ })).toBeVisible();
    await page.getByRole('searchbox', { name: /납품요구번호/ }).fill(PREFIX);
    await page.getByRole('searchbox', { name: /납품요구번호/ }).press('Enter');
    await expect(table.locator('tbody > tr')).toHaveCount(2);
    const first = table.locator('tbody > tr').nth(0);
    await expect(first).toContainText('2026-03-02');
    await expect(first).toContainText('WAPPLES');
    await expect(first).toContainText('12.3');
    await expect(table.locator('tbody > tr').nth(1)).toContainText('미등록');
    await expect(page.getByRole('radio', { name: /^휴지통/ })).toBeVisible();
  });

  test('편집: 드로어 → 확인 모달 → 저장, 이력·감사가 남고 이력이 드로어에 보인다', async ({
    page,
  }) => {
    // 감사 로그는 지우지 않는다(append-only) — 같은 E2E DB 로 다시 돌려도 맞게 증가분으로 센다
    const auditBefore = await withDb((client) =>
      auditCount(client, 'procurement.delivery.update', `${PREFIX}001-00`),
    );
    await page.getByRole('searchbox', { name: /납품요구번호/ }).fill(`${PREFIX}001`);
    await page.getByRole('searchbox', { name: /납품요구번호/ }).press('Enter');
    await page.getByRole('button', { name: `${PREFIX}001-00 편집` }).click();
    const drawer = page.getByRole('dialog', { name: `납품요구 수정 · ${PREFIX}001-00` });
    await expect(drawer.getByLabel('납품금액')).toHaveValue('12340000');
    await drawer.getByLabel('납품금액').fill('15,000,000');
    await drawer.getByRole('button', { name: '저장' }).click();
    const confirm = page.getByRole('dialog', { name: '변경 저장' });
    await expect(confirm.getByRole('list', { name: '바뀐 칸' })).toContainText(
      '납품금액: 12340000 → 15000000',
    );
    await confirm.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('저장했습니다 (1개 칸).')).toBeVisible();
    await expect(deliveriesTable(page).locator('tbody > tr').nth(0)).toContainText('15.0');

    await withDb(async (client) => {
      const rows = await syntheticRows(client);
      expect(rows.find((row) => row.dlvr_req_no === `${PREFIX}001`)?.amount).toBe('15000000');
      expect(await changeCount(client, `${PREFIX}001`)).toBe(1);
      expect(await auditCount(client, 'procurement.delivery.update', `${PREFIX}001-00`)).toBe(
        auditBefore + 1,
      );
    });

    await page.getByRole('button', { name: `${PREFIX}001-00 편집` }).click();
    const history = page
      .getByRole('dialog', { name: `납품요구 수정 · ${PREFIX}001-00` })
      .getByRole('region', { name: '변경 이력' });
    await expect(history).toContainText('납품금액: 12,340,000 → 15,000,000');
    await expect(history).toContainText(FIXTURE_ADMIN);
  });

  test('동시 편집: 연 뒤 다른 곳에서 바뀌면 "이미 처리됨" 안내 후 새로 고침', async ({ page }) => {
    await page.getByRole('searchbox', { name: /납품요구번호/ }).fill(`${PREFIX}002`);
    await page.getByRole('searchbox', { name: /납품요구번호/ }).press('Enter');
    await page.getByRole('button', { name: `${PREFIX}002-00 편집` }).click();
    const drawer = page.getByRole('dialog', { name: `납품요구 수정 · ${PREFIX}002-00` });
    await expect(drawer.getByLabel('납품업체명')).toHaveValue('E2E 다른상사');
    // 다른 사람이 먼저 바꾼 상황
    await withDb((client) =>
      client.query(
        `update procurement.deliveries set vendor = 'E2E 먼저상사' where dlvr_req_no = $1`,
        [`${PREFIX}002`],
      ),
    );
    await drawer.getByLabel('납품금액').fill('6000000');
    await drawer.getByRole('button', { name: '저장' }).click();
    await page
      .getByRole('dialog', { name: '변경 저장' })
      .getByRole('button', { name: '저장' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: '이미 처리됨' })).toBeVisible();
    await expect(drawer).toBeHidden();
    await expect(deliveriesTable(page)).toContainText('E2E 먼저상사');
    await withDb(async (client) => {
      const row = (await syntheticRows(client)).find((r) => r.dlvr_req_no === `${PREFIX}002`);
      expect(row?.amount).toBe('5000000');
      expect(await changeCount(client, `${PREFIX}002`)).toBe(0);
    });
  });

  test('휴지통으로 → 휴지통 하위 화면(삭제한 사람) → 되살리기, 모두 확인 모달', async ({
    page,
  }) => {
    const [excludeBefore, restoreBefore] = await withDb(async (client) => [
      await auditCount(client, 'procurement.delivery.exclude', `${PREFIX}001-00`),
      await auditCount(client, 'procurement.delivery.restore', `${PREFIX}001-00`),
    ]);
    await page.getByRole('searchbox', { name: /납품요구번호/ }).fill(`${PREFIX}001`);
    await page.getByRole('searchbox', { name: /납품요구번호/ }).press('Enter');
    await page.getByRole('button', { name: `${PREFIX}001-00 휴지통으로` }).click();
    const confirm = page.getByRole('dialog', { name: '휴지통으로 옮기기' });
    await expect(confirm).toContainText('휴지통에서 언제든 되살릴 수 있어요');
    await confirm.getByRole('button', { name: '휴지통으로' }).click();
    await expect(page.getByText(`${PREFIX}001-00 을(를) 휴지통으로 옮겼습니다.`)).toBeVisible();

    await page.getByRole('radio', { name: /^휴지통/ }).click();
    const trash = trashTable(page);
    // 휴지통 표에는 납품요구번호 열이 없다 — 행은 "{요청번호-차수} 되살리기" 버튼으로 찾는다
    const restoreName = `${PREFIX}001-00 되살리기`;
    // has 의 안쪽 locator 는 각 행 안에서 찾는다(표 기준 locator 를 넘기면 행 안에서 맞지 않음)
    const row = trash
      .locator('tbody > tr')
      .filter({ has: page.getByRole('button', { name: restoreName }) });
    const restore = row.getByRole('button', { name: restoreName });
    await expect(row).toContainText(FIXTURE_ADMIN);
    await expect(trash).toContainText(`${ITEM_PREFIX}1`);
    await restore.click();
    await page
      .getByRole('dialog', { name: '되살리기' })
      .getByRole('button', { name: '되살리기' })
      .click();
    await expect(page.getByText(`${PREFIX}001-00 을(를) 되살렸습니다.`)).toBeVisible();

    await withDb(async (client) => {
      expect(
        (await syntheticRows(client)).find((r) => r.dlvr_req_no === `${PREFIX}001`)?.excluded,
      ).toBe(false);
      expect(await auditCount(client, 'procurement.delivery.exclude', `${PREFIX}001-00`)).toBe(
        excludeBefore + 1,
      );
      expect(await auditCount(client, 'procurement.delivery.restore', `${PREFIX}001-00`)).toBe(
        restoreBefore + 1,
      );
    });
  });

  test('URL 이 상태: 검색 → ?q= (replace), 휴지통 → trash=1 (push), 뒤로 가기·딥링크', async ({
    page,
  }) => {
    await page.getByRole('searchbox', { name: /납품요구번호/ }).fill(`${PREFIX}002`);
    await page.getByRole('searchbox', { name: /납품요구번호/ }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`\\?tab=deliveries&q=${PREFIX}002$`));
    await expect(deliveriesTable(page).locator('tbody > tr')).toHaveCount(1);
    await page.getByRole('radio', { name: /^휴지통/ }).click();
    await expect(page).toHaveURL(/\?tab=deliveries&trash=1$/);
    // 납품요구번호는 칸 글자가 아니라 버튼 이름에만 있다
    await expect(
      trashTable(page).getByRole('button', { name: new RegExp(`^${PREFIX}003-\\d+ 되살리기$`) }),
    ).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`q=${PREFIX}002$`));
    await expect(deliveriesTable(page).locator('tbody > tr')).toHaveCount(1);

    await page.goto(`/admin/procurement?tab=deliveries&trash=1&q=${PREFIX}`);
    await expect(page.getByRole('radio', { name: /^휴지통/ })).toBeChecked();
    await expect(trashTable(page).locator('tbody > tr')).toHaveCount(1);
  });

  test('320px: 페이지 가로 스크롤 없음(표는 표 상자 안에서만 스크롤)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(deliveriesTable(page)).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  });
});
