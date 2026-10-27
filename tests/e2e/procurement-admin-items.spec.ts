import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 조달이 통합 UI-7 (조달 관리 › 품목 관리 `/admin/procurement?tab=items`, ADMIN): 일일 신규 품목 검토(행 내 제품 고르기·선택 추가·
 * 선택 삭제 확인 모달), 등록 품목(직접 추가·행 수정·일괄 변경·삭제), 휴지통(삭제자)·되살리기, 이력(item_changes)+감사(audit_logs),
 * 동시 편집 "이미 처리됨", URL 상태(검색·정렬·페이지·딥링크·뒤로 가기·조회 상태 기억), USER 직접 접근 차단, 320px 가로 스크롤 없음.
 *
 * E2E DB 에는 조달 데이터가 없다 → 이 스펙이 **합성** 품목(물품식별번호 E2E-ITEM-…, 가상 제조사)을 넣고 전후로 지운다.
 * audit_logs 는 append-only(삭제 거부 트리거)라 남는다 — 대상 id 로만 확인한다. workers 1 · serial.
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = 'E2E-ITEM-';
const ITEMS_URL = '/admin/procurement?tab=items';

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
    `delete from procurement.item_changes where item_pk in
       (select id from procurement.items where item_id like $1)`,
    [`${PREFIX}%`],
  );
  await client.query(`delete from procurement.items where item_id like $1`, [`${PREFIX}%`]);
}

type SyntheticItem = {
  code: string;
  product: string;
  status: 'pending' | 'active' | 'excluded';
  reviewed: boolean;
  name: string;
  detail?: string;
};

const ITEMS: SyntheticItem[] = [
  {
    code: `${PREFIX}P1`,
    product: '기타',
    status: 'pending',
    reviewed: false,
    name: 'E2E 미분류 품목',
  },
  {
    code: `${PREFIX}P2`,
    product: 'WAPPLES',
    status: 'active',
    reviewed: false,
    name: 'E2E 자동 분류 품목',
  },
  {
    code: `${PREFIX}P3`,
    product: 'D.AMO',
    status: 'pending',
    reviewed: false,
    name: 'E2E 뺄 품목',
  },
  {
    code: `${PREFIX}R1`,
    product: 'WAPPLES',
    status: 'active',
    reviewed: true,
    name: 'E2E 등록 품목 하나',
    detail: 'WAF',
  },
  {
    code: `${PREFIX}R2`,
    product: 'D.AMO',
    status: 'active',
    reviewed: true,
    name: 'E2E 등록 품목 둘',
    detail: 'DB',
  },
];

async function itemRow(code: string, product: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      `select id, status, reviewed, product, product_group, detail_category, item_name, source
         from procurement.items where item_id = $1 and product = $2`,
      [code, product],
    );
    return rows[0] as
      | {
          id: string;
          status: string;
          reviewed: boolean;
          product: string;
          product_group: string | null;
          detail_category: string | null;
          item_name: string | null;
          source: string;
        }
      | undefined;
  });
}

async function historyOf(id: string) {
  return withDb(async (client) => {
    const changes = await client.query(
      `select action, changed_by from procurement.item_changes where item_pk = $1 order by id`,
      [id],
    );
    const audits = await client.query(
      `select a.action, u.email from audit_logs a left join users u on u.id = a.actor_user_id
        where a.target_type = 'procurement_item' and a.target_id = $1 order by a.id`,
      [id],
    );
    return {
      changes: changes.rows as { action: string; changed_by: string }[],
      audits: audits.rows as { action: string; email: string | null }[],
    };
  });
}

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    for (const item of ITEMS) {
      await client.query(
        `insert into procurement.items (item_id, product, detail_category, manufacturer, item_name, registered_on, status, reviewed)
         values ($1, $2, $3, 'E2E 가상제조', $4, current_date, $5, $6)`,
        [item.code, item.product, item.detail ?? null, item.name, item.status, item.reviewed],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

/** 저장된 조회 상태 쿼리 (page-state B-1 — 500ms 디바운스 서버 액션이라 DB 를 폴링한다) */
async function savedQuery(email: string, pageKey: string): Promise<string | null> {
  return withDb(async (client) => {
    const { rows } = await client.query<{ query: string }>(
      `select v.query from user_view_states v join users u on u.id = v.user_id
        where u.email = $1 and v.page_key = $2`,
      [email, pageKey],
    );
    return rows[0]?.query ?? null;
  });
}

const reviewCard = (page: Page) => page.getByRole('region', { name: /일일 신규 품목/ });
const registeredCard = (page: Page) => page.getByRole('region', { name: /등록 품목/ });

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
}

test.describe('USER', () => {
  test('품목 관리 직접 접근은 / 로 이동', async ({ page }) => {
    await loginAs(page, FIXTURE_USER, '/');
    await page.goto(ITEMS_URL);
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });
});

test.describe('ADMIN', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FIXTURE_ADMIN, ITEMS_URL);
    await expect(reviewCard(page)).toBeVisible();
  });

  test('검토 카드: 제품 미정 → 제품 고르기 → 선택 추가, 이력·감사 같은 트랜잭션', async ({
    page,
  }) => {
    const card = reviewCard(page);
    await expect(card).toContainText('E2E 미분류 품목');
    await expect(card).toContainText('E2E 자동 분류 품목');

    // 제품 미정만 추가하려 하면 안내(서버 호출 없음)
    await card.getByRole('button', { name: `${PREFIX}P1 E2E 미분류 품목 추가` }).click();
    await expect(page.getByRole('alert')).toContainText('제품을 먼저 골라야');

    await card
      .getByRole('combobox', { name: `${PREFIX}P1 E2E 미분류 품목 제품명` })
      .selectOption('iSIGN');
    await expect(page.getByRole('status')).toContainText('제품명을 바꿨습니다');
    await card
      .getByRole('combobox', { name: `${PREFIX}P1 E2E 미분류 품목 세부분류` })
      .selectOption('SSO');
    await expect(page.getByRole('status')).toContainText('세부분류를 바꿨습니다');

    await card.getByRole('checkbox', { name: `${PREFIX}P1 E2E 미분류 품목 선택` }).check();
    await card.getByRole('checkbox', { name: `${PREFIX}P2 E2E 자동 분류 품목 선택` }).check();
    await card.getByRole('button', { name: '선택 추가 (2)' }).click();
    await expect(page.getByRole('status')).toContainText('2건을 등록 품목에 추가했습니다');
    await expect(card).not.toContainText('E2E 미분류 품목');

    const included = await itemRow(`${PREFIX}P1`, 'iSIGN');
    expect(included).toMatchObject({ status: 'active', reviewed: true, product_group: 'SSO' });
    const history = await historyOf(included!.id);
    expect(history.changes.map((change) => change.action)).toEqual(['edit', 'edit', 'include']);
    expect(history.changes.every((change) => change.changed_by === FIXTURE_ADMIN)).toBe(true);
    expect(history.audits.map((audit) => audit.action)).toEqual([
      'procurement.item.edit',
      'procurement.item.edit',
      'procurement.item.include',
    ]);
    expect(history.audits.every((audit) => audit.email === FIXTURE_ADMIN)).toBe(true);
    const reviewed = await itemRow(`${PREFIX}P2`, 'WAPPLES');
    expect((await historyOf(reviewed!.id)).changes.map((change) => change.action)).toEqual([
      'review',
    ]);
  });

  test('삭제는 확인 모달 → 휴지통(삭제자) → 되살리기', async ({ page }) => {
    page.on('dialog', () => {
      throw new Error('window.confirm/alert 를 쓰면 안 됩니다');
    });
    const card = reviewCard(page);
    await card.getByRole('button', { name: `${PREFIX}P3 E2E 뺄 품목 삭제` }).click();
    const dialog = page.getByRole('dialog', { name: '휴지통으로 옮기기' });
    await expect(dialog).toContainText('휴지통으로 옮길까요?');
    await dialog.getByRole('button', { name: '삭제' }).click();
    await expect(page.getByRole('status')).toContainText('1건을 휴지통으로 옮겼습니다');
    await expect(card).not.toContainText('E2E 뺄 품목');

    const registered = registeredCard(page);
    await registered.getByRole('button', { name: /^휴지통/ }).click();
    const trash = registered.getByRole('region', { name: '휴지통' });
    const trashRow = trash.getByRole('row').filter({ hasText: 'E2E 뺄 품목' });
    await expect(trashRow).toContainText(FIXTURE_ADMIN);
    await trashRow.getByRole('button', { name: `${PREFIX}P3 D.AMO 되살리기` }).click();
    await expect(page.getByRole('status')).toContainText('되살렸습니다');
    // 제품이 정해진 품목은 등록 품목으로 돌아간다
    expect(await itemRow(`${PREFIX}P3`, 'D.AMO')).toMatchObject({ status: 'active' });
  });

  test('등록 품목: 직접 추가(manual) · 행 수정 · 일괄 변경 · 삭제 확인', async ({ page }) => {
    const card = registeredCard(page);
    await card.getByRole('button', { name: '+ 직접 추가' }).click();
    const form = card.getByRole('form', { name: '품목 직접 추가' });
    await form.getByRole('combobox', { name: '제품명 *' }).selectOption('D.AMO');
    await form.getByRole('textbox', { name: '물품식별번호 *' }).fill(`${PREFIX}M1`);
    await form.getByRole('textbox', { name: '품목명' }).fill('E2E 직접 추가 품목');
    await form.getByRole('button', { name: '추가' }).click();
    await expect(page.getByRole('status')).toContainText(
      `D.AMO ${PREFIX}M1 를 등록 품목에 추가했습니다`,
    );
    expect(await itemRow(`${PREFIX}M1`, 'D.AMO')).toMatchObject({
      source: 'manual',
      status: 'active',
    });

    // 같은 조합 다시 추가 → 안내
    await form.getByRole('textbox', { name: '물품식별번호 *' }).fill(`${PREFIX}M1`);
    await form.getByRole('button', { name: '추가' }).click();
    await expect(form.getByRole('alert')).toContainText('이미 등록되어 있습니다');

    await card.getByRole('textbox', { name: '물품식별번호·품목·제조사 검색' }).fill(PREFIX);
    await card.getByRole('button', { name: '검색' }).click();
    await card.getByRole('button', { name: `${PREFIX}R1 WAPPLES 수정` }).click();
    const edit = page.getByRole('dialog', { name: '품목 수정' });
    await edit.getByRole('textbox', { name: '품목' }).fill('E2E 이름 바꾼 품목');
    await edit.getByRole('button', { name: '저장' }).click();
    await expect(edit).toHaveCount(0);
    await expect(card).toContainText('E2E 이름 바꾼 품목');

    await card.getByRole('checkbox', { name: `${PREFIX}R1 WAPPLES 선택` }).check();
    await card.getByRole('checkbox', { name: `${PREFIX}R2 D.AMO 선택` }).check();
    const bar = card.getByRole('group', { name: '선택한 품목 일괄 변경' });
    await bar.getByRole('combobox', { name: '제품명 일괄 변경' }).selectOption('iSIGN');
    await bar.getByRole('combobox', { name: '세부분류 일괄 변경' }).selectOption('PKI');
    await bar.getByRole('button', { name: '적용' }).click();
    const confirm = page.getByRole('dialog', { name: '일괄 변경' });
    await expect(confirm).toContainText('2건의 제품명 → iSIGN, 세부분류 → PKI');
    await confirm.getByRole('button', { name: '적용' }).click();
    await expect(page.getByRole('status')).toContainText('2건을 바꿨습니다');
    expect(await itemRow(`${PREFIX}R1`, 'iSIGN')).toMatchObject({ product_group: 'WA' });

    await card.getByRole('button', { name: `${PREFIX}R2 iSIGN 삭제` }).click();
    const remove = page.getByRole('dialog', { name: '휴지통으로 옮기기' });
    await remove.getByRole('button', { name: '취소' }).click();
    await expect(remove).toHaveCount(0);
    expect(await itemRow(`${PREFIX}R2`, 'iSIGN')).toMatchObject({ status: 'active' });
  });

  test('동시 편집: 다른 곳에서 먼저 처리된 품목은 "이미 처리됨" 후 새로고침', async ({ page }) => {
    await withDb((client) =>
      client.query(
        `insert into procurement.items (item_id, product, item_name, registered_on, status, reviewed)
         values ($1, 'WAPPLES', 'E2E 동시 편집 품목', current_date, 'pending', false)`,
        [`${PREFIX}C1`],
      ),
    );
    await page.reload();
    const card = reviewCard(page);
    await expect(card).toContainText('E2E 동시 편집 품목');
    // 화면이 읽은 뒤 다른 관리자가 먼저 휴지통으로 보냈다고 가정
    await withDb((client) =>
      client.query(`update procurement.items set status = 'excluded' where item_id = $1`, [
        `${PREFIX}C1`,
      ]),
    );
    await card.getByRole('button', { name: `${PREFIX}C1 E2E 동시 편집 품목 추가` }).click();
    await expect(page.getByRole('status')).toContainText('이미 처리됨');
    await expect(card).not.toContainText('E2E 동시 편집 품목');
  });

  test('URL 이 상태: 검색 → replace, 정렬 → push(뒤로 가기), 딥링크, 조회 상태 기억, 탭 전환은 조건을 버린다', async ({
    page,
  }) => {
    const card = registeredCard(page);
    const table = () => registeredCard(page).getByRole('table', { name: '등록 품목' });
    await card.getByRole('textbox', { name: '물품식별번호·품목·제조사 검색' }).fill(`${PREFIX}R`);
    await card.getByRole('button', { name: '검색' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/procurement\\?tab=items&q=${PREFIX}R$`));
    await expect(table().locator('tbody > tr')).toHaveCount(2);

    await table()
      .getByRole('button', { name: /물품식별번호/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`\\?tab=items&q=${PREFIX}R&sort=itemId&dir=asc$`));
    await expect(table().getByRole('columnheader', { name: /물품식별번호/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(table().locator('tbody > tr').first()).toContainText(`${PREFIX}R1`);

    // 정렬은 push — 뒤로 가기로 정렬 전 URL·화면
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`\\?tab=items&q=${PREFIX}R$`));
    await expect(table().getByRole('columnheader', { name: /물품식별번호/ })).not.toHaveAttribute(
      'aria-sort',
    );

    // 딥링크: 서버가 URL 조건으로 그린다
    const deepLink = `/admin/procurement?tab=items&q=${PREFIX}R&sort=itemId&dir=desc`;
    await page.goto(deepLink);
    await expect(card.getByRole('textbox', { name: '물품식별번호·품목·제조사 검색' })).toHaveValue(
      `${PREFIX}R`,
    );
    await expect(table().locator('tbody > tr').first()).toContainText(`${PREFIX}R2`);

    // 조회 상태 기억(page_key admin-procurement): 파라미터 없이 들어오면 마지막 품목 조건으로
    await expect
      .poll(() => savedQuery(FIXTURE_ADMIN, 'admin-procurement'), { timeout: 10_000 })
      .toBe(deepLink.split('?')[1]);
    await page.goto('/admin/procurement');
    await expect(page).toHaveURL(new RegExp(`\\?tab=items&q=${PREFIX}R&sort=itemId&dir=desc$`));

    // 탭 전환은 ?tab= 만 (품목 조건을 다른 탭으로 옮기지 않는다)
    await page
      .getByRole('radiogroup', { name: '조달 관리 메뉴' })
      .getByRole('radio', { name: '키워드 관리' })
      .click();
    await expect(page).toHaveURL(/\/admin\/procurement\?tab=keywords$/);
  });

  test('320px: 가로 스크롤 없음 (표는 표 안에서만 스크롤)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(ITEMS_URL);
    await expect(reviewCard(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
