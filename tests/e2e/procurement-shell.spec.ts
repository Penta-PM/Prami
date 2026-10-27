import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 조달이 통합 UI-1 (IA·셸): 사이드바 "조달" 섹션(procurement.read)·관리자 "조달 관리"(procurement.write, D-2 탭 3개),
 * 직접 URL 접근 차단, 수집 시각 머리. E2E DB 에는 조달 데이터가 없다 → "아직 수집 기록이 없습니다".
 */
const PROCUREMENT_LINKS = [
  { name: '조달 실적 현황', path: '/procurement' },
  { name: '등록 품목', path: '/procurement/items' },
  { name: '입찰 공고', path: '/procurement/bids' },
] as const;

const sidebar = (page: Page) => page.getByRole('complementary', { name: '주 메뉴' });

/** 저장된 조회 상태 쿼리 (page-state B-1 — 500ms 디바운스 서버 액션이라 DB 를 폴링한다) */
async function savedQuery(email: string, pageKey: string): Promise<string | null> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ query: string }>(
      `select v.query from user_view_states v join users u on u.id = v.user_id
       where u.email = $1 and v.page_key = $2`,
      [email, pageKey],
    );
    return rows[0]?.query ?? null;
  } finally {
    await client.end();
  }
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
}

test.describe('USER', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FIXTURE_USER, '/');
  });

  test('조달 섹션 링크 3개로 이동하고, 조달 관리는 보이지 않는다', async ({ page }) => {
    const nav = sidebar(page);
    await expect(nav.getByText('조달', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '조달 관리' })).toHaveCount(0);
    for (const link of PROCUREMENT_LINKS) {
      await nav.getByRole('link', { name: link.name }).click();
      await expect(page).toHaveURL((url) => url.pathname === link.path);
      await expect(page.getByRole('heading', { level: 1, name: link.name })).toBeVisible();
      await expect(nav.getByRole('link', { name: link.name })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByTestId('procurement-collected-at')).toHaveText(
        '아직 수집 기록이 없습니다',
      );
      // 입찰 공고는 UI-3 화면(tests/e2e/procurement-bids.spec.ts) — E2E DB 에 공고가 없으면 빈 상태
      await expect(
        page.getByText(
          link.path === '/procurement/bids' ? '진행 중인 입찰 공고가 없습니다' : '화면 준비 중',
        ),
      ).toBeVisible();
    }
  });

  test('/admin/procurement 직접 접근은 / 로 이동', async ({ page }) => {
    await page.goto('/admin/procurement');
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });
});

test.describe('ADMIN', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FIXTURE_ADMIN, '/');
  });

  test('조달 섹션과 관리자 조달 관리가 보이고, 조달 관리 탭 3개를 전환한다', async ({ page }) => {
    const nav = sidebar(page);
    for (const link of PROCUREMENT_LINKS) {
      await expect(nav.getByRole('link', { name: link.name })).toBeVisible();
    }
    await nav.getByRole('link', { name: '조달 관리' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/admin/procurement');
    await expect(page.getByRole('heading', { level: 1, name: '조달 관리' })).toBeVisible();
    await expect(page.getByTestId('procurement-collected-at')).toHaveText(
      '아직 수집 기록이 없습니다',
    );

    const tabs = page.getByRole('radiogroup', { name: '조달 관리 메뉴' });
    await expect(tabs.getByRole('radio')).toHaveText(['실적 관리', '품목 관리', '키워드 관리']);
    await expect(tabs.getByRole('radio', { name: '실적 관리' })).toBeChecked();
    await expect(page.getByRole('region', { name: '실적 관리' })).toContainText('단계 3에서 제공');

    await tabs.getByRole('radio', { name: '키워드 관리' }).click();
    await expect(tabs.getByRole('radio', { name: '키워드 관리' })).toBeChecked();
    await expect(page).toHaveURL(/\/admin\/procurement\?tab=keywords$/);
    await expect(page.getByRole('region', { name: '키워드 관리' })).toContainText(
      '단계 3에서 제공',
    );

    // 조회 상태 기억(B-1): 저장된 뒤 파라미터 없이 다시 들어오면 마지막 탭
    await expect
      .poll(() => savedQuery(FIXTURE_ADMIN, 'admin-procurement'), { timeout: 10_000 })
      .toBe('tab=keywords');
    await page.goto('/admin/procurement');
    await expect(page).toHaveURL(/\/admin\/procurement\?tab=keywords$/);
    await expect(tabs.getByRole('radio', { name: '키워드 관리' })).toBeChecked();
  });

  test('375px: 조달 화면·조달 관리에 가로 스크롤이 없다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    for (const path of [...PROCUREMENT_LINKS.map((link) => link.path), '/admin/procurement']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('procurement-collected-at')).toHaveText(
        '아직 수집 기록이 없습니다',
      );
      await expectNoHorizontalScroll(page);
    }
  });
});
