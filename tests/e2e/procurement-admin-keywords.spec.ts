import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * 조달이 통합 UI-8 (조달 관리 → 키워드 관리 `/admin/procurement?tab=keywords`, procurement.write = ADMIN):
 * 제품별·제외 그룹 칩, Enter 로 추가(DB created_by = 관리자 메일 + 감사 procurement.keyword.add), × "{키워드} 삭제" → 확인 모달 →
 * 삭제(감사 procurement.keyword.delete), 탭 전환 push·뒤로 가기, 동시 편집 "이미 처리됨"(다른 곳에서 먼저 지움·먼저 추가), 320px 가로 스크롤 없음.
 *
 * E2E DB 에는 조달 데이터가 없다 → 이 스펙이 **합성** 키워드(E2E-KW- 접두)를 넣고 전후로 지운다. workers 1 · serial.
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = 'E2E-KW-';
const PATH = '/admin/procurement?tab=keywords';

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
  await client.query(`delete from procurement.bid_keywords where keyword like $1`, [`${PREFIX}%`]);
}

async function insertKeyword(product: string, keyword: string, createdBy: string | null = '기본') {
  return withDb(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into procurement.bid_keywords (product, keyword, created_by) values ($1, $2, $3) returning id`,
      [product, keyword, createdBy],
    );
    return Number(rows[0]!.id);
  });
}

async function keywordRow(product: string, keyword: string) {
  return withDb(async (client) => {
    const { rows } = await client.query<{ id: string; created_by: string | null }>(
      `select id, created_by from procurement.bid_keywords where product = $1 and keyword = $2`,
      [product, keyword],
    );
    return rows[0] ?? null;
  });
}

async function auditCount(action: string, targetId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from audit_logs where action = $1 and target_id = $2 and result = 'success'`,
      [action, targetId],
    );
    return rows[0]!.n;
  });
}

test.beforeAll(async () => {
  await withDb(cleanUp);
  await insertKeyword('WAPPLES', `${PREFIX}가상 방화벽`);
  await insertKeyword('제외', `${PREFIX}가상 제외어`, 'someone@example.invalid');
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

const region = (page: Page) => page.getByRole('region', { name: '키워드 관리' });
const group = (page: Page, name: string) => region(page).getByRole('group', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, PATH);
  await expect(group(page, 'WAPPLES')).toBeVisible();
});

test('그룹 4개·칩·마지막 확인 시각, 직접 추가 칩은 추가한 사람을 보여 준다', async ({ page }) => {
  await expect(region(page).getByRole('heading', { name: '분류 키워드' })).toBeVisible();
  await expect(page.getByTestId('procurement-keywords-last-checked')).toBeVisible();
  for (const name of ['WAPPLES', 'D.AMO', 'iSIGN', '제외 단어']) {
    await expect(group(page, name)).toBeVisible();
  }
  await expect(
    group(page, 'WAPPLES').getByRole('button', { name: `${PREFIX}가상 방화벽 삭제` }),
  ).toBeVisible();
  const manual = group(page, '제외 단어')
    .getByRole('listitem')
    .filter({ hasText: `${PREFIX}가상 제외어` });
  await expect(manual).toHaveAttribute('title', '추가: someone');
});

test('Enter 로 추가 → 칩 + DB(created_by = 관리자) + 감사 procurement.keyword.add', async ({
  page,
}) => {
  const keyword = `${PREFIX}가상 암호화`;
  const input = group(page, 'D.AMO').getByRole('textbox', { name: 'D.AMO 키워드 추가' });
  await input.fill(`  ${keyword}  `);
  await input.press('Enter');
  await expect(group(page, 'D.AMO').getByRole('button', { name: `${keyword} 삭제` })).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(region(page).getByRole('status')).toHaveText(`추가했습니다: ${keyword}`);
  const row = await keywordRow('D.AMO', keyword);
  expect(row?.created_by).toBe(FIXTURE_ADMIN);
  expect(await auditCount('procurement.keyword.add', String(row!.id))).toBe(1);
});

test('그룹 안 중복은 화면에서 막는다', async ({ page }) => {
  const input = group(page, 'WAPPLES').getByRole('textbox', { name: 'WAPPLES 키워드 추가' });
  await input.fill(`${PREFIX}가상 방화벽`);
  await input.press('Enter');
  await expect(group(page, 'WAPPLES').getByRole('alert')).toHaveText(
    `이미 있는 키워드입니다: ${PREFIX}가상 방화벽`,
  );
});

test('× → 확인 모달(취소·삭제) → 칩 사라짐 + 감사 procurement.keyword.delete', async ({ page }) => {
  const keyword = `${PREFIX}삭제 대상`;
  const id = await insertKeyword('iSIGN', keyword);
  await page.reload();
  const remove = group(page, 'iSIGN').getByRole('button', { name: `${keyword} 삭제` });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: '키워드 삭제' });
  await expect(dialog).toContainText(`${keyword} 키워드를 삭제할까요?`);
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toBeHidden();
  expect(await keywordRow('iSIGN', keyword)).not.toBeNull();

  await remove.focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('dialog', { name: '키워드 삭제' })
    .getByRole('button', { name: '삭제' })
    .click();
  await expect(remove).toHaveCount(0);
  await expect(region(page).getByRole('status')).toHaveText(`삭제했습니다: ${keyword}`);
  expect(await keywordRow('iSIGN', keyword)).toBeNull();
  expect(await auditCount('procurement.keyword.delete', String(id))).toBe(1);
});

test('동시 편집: 다른 곳에서 먼저 지운 키워드 삭제 → "이미 처리됨" + 새로 불러오기', async ({
  page,
}) => {
  const keyword = `${PREFIX}먼저 지워짐`;
  await insertKeyword('WAPPLES', keyword);
  await page.reload();
  await group(page, 'WAPPLES')
    .getByRole('button', { name: `${keyword} 삭제` })
    .click();
  await withDb((client) =>
    client.query(`delete from procurement.bid_keywords where keyword = $1`, [keyword]),
  );
  await page
    .getByRole('dialog', { name: '키워드 삭제' })
    .getByRole('button', { name: '삭제' })
    .click();
  await expect(region(page).getByRole('status')).toContainText('이미 처리됨');
  await expect(group(page, 'WAPPLES').getByRole('button', { name: `${keyword} 삭제` })).toHaveCount(
    0,
  );
});

test('동시 편집: 다른 곳에서 먼저 추가된 키워드 추가 → "이미 처리됨" + 칩 1개', async ({
  page,
}) => {
  const keyword = `${PREFIX}먼저 추가됨`;
  await insertKeyword('iSIGN', keyword);
  const input = group(page, 'iSIGN').getByRole('textbox', { name: 'iSIGN 키워드 추가' });
  await input.fill(keyword);
  await input.press('Enter');
  await expect(region(page).getByRole('status')).toContainText('이미 처리됨');
  await expect(group(page, 'iSIGN').getByRole('button', { name: `${keyword} 삭제` })).toHaveCount(
    1,
  );
});

test('탭 전환은 router.push(?tab=) — 다른 탭 파라미터는 버리고, 뒤로 가기로 돌아온다', async ({
  page,
}) => {
  await page.goto('/admin/procurement?tab=items&page=2');
  const tabs = page.getByRole('radiogroup', { name: '조달 관리 메뉴' });
  await tabs.getByRole('radio', { name: '키워드 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/procurement\?tab=keywords$/);
  await expect(group(page, 'WAPPLES')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/procurement\?tab=items&page=2$/);
  await expect(tabs.getByRole('radio', { name: '품목 관리' })).toBeChecked();
});

test('320px: 가로 스크롤이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  await expect(group(page, '제외 단어')).toBeVisible();
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
});
