import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 수집기 Prami 이전 §3.1 (조달 관리 → 메일 보고 `/admin/procurement?tab=mail`, procurement.write = ADMIN):
 * USER 차단, 빈 상태 문구·상태 카드, 추가(앞뒤 공백 제거 + DB created_by = 관리자 + 감사 procurement.mail_recipient.add),
 * 대소문자 무시 중복·형식 오류는 입력칸 아래, 삭제 버튼 → 확인 모달(취소·삭제) → 감사 procurement.mail_recipient.remove.
 *
 * 합성 주소만(example.invalid). 빈 상태를 보려고 기존 수신처를 beforeAll 에서 따로 보관하고 비운 뒤 afterAll 에서 되돌린다
 * (새 DB 가 아니어도 다시 돌릴 수 있게). audit_logs 는 추가 전용이라 감사는 전후 건수 차이(+1)로 본다. workers 1 · serial.
 */
test.describe.configure({ mode: 'serial' });

const PATH = '/admin/procurement?tab=mail';
const PREFIX = 'e2e-mail-';
const ADDRESS = `E2E-Mail-A@example.invalid`;
const ADD = 'procurement.mail_recipient.add';
const REMOVE = 'procurement.mail_recipient.remove';

type SavedRecipient = { email: string; created_by: string | null; created_at: Date };
let saved: SavedRecipient[] = [];

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function recipientRow(email: string) {
  return withDb(async (client) => {
    const { rows } = await client.query<{ id: string; email: string; created_by: string | null }>(
      `select id, email, created_by from procurement.mail_recipients where lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ?? null;
  });
}

async function insertRecipient(email: string) {
  return withDb(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into procurement.mail_recipients (email, created_by) values ($1, $2) returning id`,
      [email, 'someone@example.invalid'],
    );
    return Number(rows[0]!.id);
  });
}

async function auditCount(action: string) {
  return withDb(async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from audit_logs where action = $1 and result = 'success'`,
      [action],
    );
    return rows[0]!.n;
  });
}

test.beforeAll(async () => {
  await withDb(async (client) => {
    // 이 스펙이 남긴 행(이전 실패 실행 포함)은 버리고, 그 밖의 수신처는 보관 후 비운다
    await client.query(`delete from procurement.mail_recipients where lower(email) like $1`, [
      `${PREFIX}%`,
    ]);
    const { rows } = await client.query<SavedRecipient>(
      `select email, created_by, created_at from procurement.mail_recipients order by id`,
    );
    saved = rows;
    await client.query(`delete from procurement.mail_recipients`);
  });
});

test.afterAll(async () => {
  await withDb(async (client) => {
    await client.query(`delete from procurement.mail_recipients where lower(email) like $1`, [
      `${PREFIX}%`,
    ]);
    for (const row of saved) {
      await client.query(
        `insert into procurement.mail_recipients (email, created_by, created_at) values ($1, $2, $3)
         on conflict do nothing`,
        [row.email, row.created_by, row.created_at],
      );
    }
  });
});

const region = (page: Page) => page.getByRole('region', { name: '메일 보고' });
const input = (page: Page) => region(page).getByRole('textbox', { name: '수신처 추가' });

test.describe('USER', () => {
  test('메일 보고 탭 직접 접근은 / 로 이동', async ({ page }) => {
    await loginAs(page, FIXTURE_USER, '/');
    await page.goto(PATH);
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });
});

test.describe('ADMIN', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FIXTURE_ADMIN, PATH);
    await expect(region(page).getByRole('heading', { name: '수신처' })).toBeVisible();
  });

  test('빈 상태 문구 + 상태 카드(마지막 보고 실행·결과·보고 기준일)', async ({ page }) => {
    await expect(region(page).getByText('수신처가 없어 보고 메일을 보내지 않습니다')).toBeVisible();
    await expect(region(page).getByRole('table', { name: '메일 수신처' })).toHaveCount(0);
    for (const id of [
      'procurement-mail-last-run',
      'procurement-mail-result',
      'procurement-mail-last-end-date',
    ]) {
      await expect(page.getByTestId(id)).not.toBeEmpty();
    }
  });

  test('추가: 앞뒤 공백 제거 → 목록 행 + DB(created_by = 관리자) + 감사 add +1', async ({
    page,
  }) => {
    const before = await auditCount(ADD);
    await input(page).fill(`   ${ADDRESS}  `);
    await input(page).press('Enter');
    const table = region(page).getByRole('table', { name: '메일 수신처' });
    await expect(table.getByRole('cell', { name: ADDRESS, exact: true })).toBeVisible();
    await expect(input(page)).toHaveValue('');
    await expect(region(page).getByRole('status')).toHaveText(`추가했습니다: ${ADDRESS}`);
    await expect(region(page).getByText('수신처가 없어 보고 메일을 보내지 않습니다')).toHaveCount(
      0,
    );
    const row = await recipientRow(ADDRESS);
    expect(row).toMatchObject({ email: ADDRESS, created_by: FIXTURE_ADMIN });
    expect(await auditCount(ADD)).toBe(before + 1);
  });

  test('대소문자만 다른 중복·형식 오류는 입력칸 아래 안내, 추가되지 않는다', async ({ page }) => {
    const before = await auditCount(ADD);
    await input(page).fill(ADDRESS.toLowerCase().replace('example', 'EXAMPLE'));
    await input(page).press('Enter');
    const alert = region(page).getByRole('alert');
    await expect(alert).toHaveText(`이미 등록된 주소입니다: ${ADDRESS}`);
    await expect(input(page)).toHaveAttribute('aria-invalid', 'true');

    await input(page).fill(`${PREFIX}not-an-address`);
    await input(page).press('Enter');
    await expect(alert).toContainText('메일 주소 형식이 아닙니다');
    expect(await auditCount(ADD)).toBe(before);
    await expect(
      region(page).getByRole('table', { name: '메일 수신처' }).getByRole('row'),
    ).toHaveCount(2);
  });

  test('삭제 → 확인 모달(취소·삭제) → 행 사라짐 + 감사 remove +1 + 빈 상태', async ({ page }) => {
    const remove = region(page).getByRole('button', { name: `${ADDRESS} 삭제` });
    await remove.click();
    const dialog = page.getByRole('dialog', { name: '수신처 삭제' });
    await expect(dialog).toContainText(`${ADDRESS} 수신처를 삭제할까요?`);
    await expect(dialog).toContainText('남는 수신처가 없어 보고 메일이 멈춥니다');
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toBeHidden();
    expect(await recipientRow(ADDRESS)).not.toBeNull();

    const before = await auditCount(REMOVE);
    await remove.click();
    await page
      .getByRole('dialog', { name: '수신처 삭제' })
      .getByRole('button', { name: '삭제' })
      .click();
    await expect(remove).toHaveCount(0);
    await expect(region(page).getByRole('status')).toHaveText(`삭제했습니다: ${ADDRESS}`);
    await expect(region(page).getByText('수신처가 없어 보고 메일을 보내지 않습니다')).toBeVisible();
    expect(await recipientRow(ADDRESS)).toBeNull();
    expect(await auditCount(REMOVE)).toBe(before + 1);
  });

  test('동시 편집: 다른 곳에서 먼저 지운 수신처 삭제 → "이미 처리됨" + 새로 불러오기', async ({
    page,
  }) => {
    const email = `${PREFIX}gone@example.invalid`;
    await insertRecipient(email);
    await page.reload();
    await region(page)
      .getByRole('button', { name: `${email} 삭제` })
      .click();
    await withDb((client) =>
      client.query(`delete from procurement.mail_recipients where email = $1`, [email]),
    );
    await page
      .getByRole('dialog', { name: '수신처 삭제' })
      .getByRole('button', { name: '삭제' })
      .click();
    await expect(region(page).getByRole('status')).toContainText('이미 처리됨');
    await expect(region(page).getByRole('button', { name: `${email} 삭제` })).toHaveCount(0);
  });

  test('탭 전환은 router.push(?tab=mail) — 다른 탭 파라미터는 버린다', async ({ page }) => {
    await page.goto('/admin/procurement?tab=items&page=2');
    const tabs = page.getByRole('radiogroup', { name: '조달 관리 메뉴' });
    await tabs.getByRole('radio', { name: '메일 보고' }).click();
    await expect(page).toHaveURL(/\/admin\/procurement\?tab=mail$/);
    await expect(tabs.getByRole('radio', { name: '메일 보고' })).toBeChecked();
    await expect(region(page).getByRole('heading', { name: '수신처' })).toBeVisible();
  });

  test('320px: 가로 스크롤이 없다', async ({ page }) => {
    await insertRecipient(`${PREFIX}a-rather-long-local-part-for-layout@example.invalid`);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.reload();
    await expect(region(page).getByRole('heading', { name: '수신처' })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  });
});
