import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import {
  expectNoHydrationErrors,
  FIXTURE_ADMIN,
  FIXTURE_USER,
  loginAs,
  signOutLocally,
} from './helpers';

/**
 * 페이지 상태 기억 B-1 — 조회 상태 (docs/specs/page-state-memory.md §2.2·§2.3·§4).
 * 필터·정렬·페이지 → 다른 메뉴 → 사이드바 복귀 시 같은 URL(첫 응답이 복원 상태 = 서버 redirect), 명시 파라미터 우선,
 * '필터 초기화' 후 재진입 깨끗, 클라이언트 표 정렬 새로고침·재진입 유지, 사용자 B 는 A 의 상태를 못 봄, 스크롤 ±1행 복원.
 * 저장은 500ms 디바운스 서버 액션이라 DB 행을 폴링해 저장 완료를 기다린다.
 */
test.describe.configure({ mode: 'serial' });

async function savedRow(
  email: string,
  pageKey: string,
): Promise<{ query: string; scroll: { query: string; top: number } | null } | null> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      query: string;
      scroll: { query: string; top: number } | null;
    }>(
      `select v.query, v.scroll from user_view_states v join users u on u.id = v.user_id
       where u.email = $1 and v.page_key = $2`,
      [email, pageKey],
    );
    return rows[0] ?? null;
  } finally {
    await client.end();
  }
}

/** 저장된 쿼리가 기대값이 될 때까지 (디바운스 500ms + 서버 액션) */
async function expectSavedQuery(email: string, pageKey: string, query: string) {
  await expect
    .poll(async () => (await savedRow(email, pageKey))?.query, { timeout: 10_000 })
    .toBe(query);
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: '주 메뉴' });
const search = (page: Page) => new URL(page.url()).search.slice(1);

test('가격 조회: 필터·정렬·페이지 → 다른 메뉴 → 사이드바 복귀 시 같은 URL, 첫 응답이 복원 상태', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing');
  await page.getByRole('radio', { name: '적용기간 기준' }).click();
  await expect(page).toHaveURL(/dateMode=period/);
  const table = page.getByRole('table', { name: '가격정책 표' });
  await table.getByRole('columnheader', { name: '품목명' }).getByRole('button').click();
  await expect(page).toHaveURL(/dateMode=period&sort=itemName&dir=asc$/);
  await page
    .getByRole('navigation', { name: '페이지' })
    .getByRole('link', { name: '다음' })
    .click();
  await expect(page).toHaveURL(/dateMode=period&page=2&sort=itemName&dir=asc$/);
  const expected = search(page);
  await expectSavedQuery(FIXTURE_USER, 'pricing', expected);

  await sidebar(page).getByRole('link', { name: '계산기' }).click();
  await expect(page).toHaveURL(/\/calculator/);
  await sidebar(page).getByRole('link', { name: '가격 정책 조회' }).click();
  await expect(page).toHaveURL(`/pricing?${expected}`);
  await expect(page.getByText(/· 2 \/ \d+ 페이지/)).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '품목명' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );

  // 주소창 진입(전체 로드): 서버가 redirect 한 응답 하나로 복원 — 클라이언트에서 다시 바꾸지 않는다
  const response = await page.goto('/pricing');
  expect(response?.request().redirectedFrom()?.url()).toMatch(/\/pricing$/);
  expect(new URL(response!.url()).search.slice(1)).toBe(expected);
  expectNoHydrationErrors(page);
});

test('파라미터가 명시된 링크가 우선이고 새 저장값이 된다', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/pricing?q=P1');
  await expectSavedQuery(FIXTURE_USER, 'pricing', 'q=P1');
  await page.goto('/pricing?q=P2');
  await expect(page).toHaveURL('/pricing?q=P2');
  await expectSavedQuery(FIXTURE_USER, 'pricing', 'q=P2');
  await sidebar(page).getByRole('link', { name: '계산기' }).click();
  await sidebar(page).getByRole('link', { name: '가격 정책 조회' }).click();
  await expect(page).toHaveURL('/pricing?q=P2');
});

test("'필터 초기화' 후 재진입 시 이전 조건이 되살아나지 않는다", async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/pricing?q=P&dateMode=period');
  await expectSavedQuery(FIXTURE_USER, 'pricing', 'q=P&dateMode=period');
  await page.getByRole('button', { name: '필터 초기화' }).first().click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expectSavedQuery(FIXTURE_USER, 'pricing', '');
  await sidebar(page).getByRole('link', { name: '계산기' }).click();
  await sidebar(page).getByRole('link', { name: '가격 정책 조회' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await page.goto('/pricing');
  await expect(page).toHaveURL(/\/pricing$/);
});

test('클라이언트 표(사용자) 정렬·필터가 새로고침·재진입·재로그인 후 유지', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const table = page.getByRole('table', { name: '사용자 목록' });
  await table.getByRole('columnheader', { name: '이메일' }).getByRole('button').click();
  await table.getByRole('columnheader', { name: '이메일' }).getByRole('button').click();
  await expect(page).toHaveURL(/\/admin\/users\?sort=email&dir=desc$/);
  await page.reload();
  await expect(table.getByRole('columnheader', { name: '이메일' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expectSavedQuery(FIXTURE_ADMIN, 'admin-users', 'sort=email&dir=desc');

  await sidebar(page).getByRole('link', { name: '감사 로그' }).click();
  await expect(page).toHaveURL(/\/admin\/audit/);
  await sidebar(page).getByRole('link', { name: '사용자 · 권한' }).click();
  await expect(page).toHaveURL('/admin/users?sort=email&dir=desc');

  // 브라우저 재시작 + 재로그인(쿠키 없음)에도 같은 사용자에게 복원
  await signOutLocally(page);
  await loginAs(page, FIXTURE_ADMIN, '/admin/users', { keepViewState: true });
  await expect(page).toHaveURL('/admin/users?sort=email&dir=desc');
});

test('계산기 탭: 순매출 탭 → 다른 메뉴 → 복귀 시 같은 탭', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await page.getByRole('radio', { name: '순매출 계산기' }).click();
  await expect(page).toHaveURL('/calculator?tab=margin');
  await expectSavedQuery(FIXTURE_USER, 'calculator', 'tab=margin');
  await sidebar(page).getByRole('link', { name: '가격 정책 조회' }).click();
  await sidebar(page).getByRole('link', { name: '계산기' }).click();
  await expect(page).toHaveURL('/calculator?tab=margin');
  await expect(page.getByRole('radio', { name: '순매출 계산기' })).toBeChecked();
});

test('사용자 B 는 같은 브라우저·탭에서도 A 의 조회 상태를 보지 않는다', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/pricing?q=ADMIN-ONLY');
  await expectSavedQuery(FIXTURE_ADMIN, 'pricing', 'q=ADMIN-ONLY');
  await signOutLocally(page);
  await loginAs(page, FIXTURE_USER, '/pricing');
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('searchbox', { name: '품목명·품번 검색' })).toHaveValue('');
});

test('스크롤: 같은 조회 조건으로 돌아오면 <main> 위치 ±1행 복원, 조건이 바뀌면 맨 위', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing?dateMode=period');
  const main = page.locator('main#app-main');
  const row = page.getByRole('table', { name: '가격정책 표' }).locator('tbody tr').first();
  const rowHeight = (await row.boundingBox())!.height;
  await main.evaluate((element) => {
    element.scrollTop = 900;
    element.dispatchEvent(new Event('scroll'));
  });
  const top = await main.evaluate((element) => element.scrollTop);
  expect(top).toBeGreaterThan(rowHeight * 3);

  await sidebar(page).getByRole('link', { name: '계산기' }).click();
  await expect(page).toHaveURL(/\/calculator/);
  await expect
    .poll(async () => (await savedRow(FIXTURE_USER, 'pricing'))?.scroll, { timeout: 10_000 })
    .toEqual({ query: 'dateMode=period', top: Math.round(top) });

  await sidebar(page).getByRole('link', { name: '가격 정책 조회' }).click();
  await expect(page).toHaveURL('/pricing?dateMode=period');
  await expect
    .poll(() => main.evaluate((element) => element.scrollTop))
    .toBeGreaterThanOrEqual(top - rowHeight);
  expect(Math.abs((await main.evaluate((element) => element.scrollTop)) - top)).toBeLessThanOrEqual(
    rowHeight,
  );

  // 조건 변경(페이지) → 맨 위
  await page
    .getByRole('navigation', { name: '페이지' })
    .getByRole('link', { name: '다음' })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);
  expectNoHydrationErrors(page);
});
