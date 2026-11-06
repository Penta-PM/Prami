import { expect, test } from '@playwright/test';

import { FIXTURE_USER, loginAs } from './helpers';

/**
 * 모바일 UI M0 데스크톱 불변 (docs/specs/mobile-ui.md §6·§7): 1280px 에서는 기존 셸·모달 그대로 —
 * 사이드바가 레이아웃에 있고, 헤더 72px·이름·설정·로그아웃, 모바일 컨트롤(☰·검색 아이콘·아바타 시트)은 숨고, 모달은 가운데 다이얼로그.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test('1280px: 사이드바·72px 헤더·검색창·사용자 표시 그대로, 모바일 컨트롤 숨김', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/');
  await expect(page.getByRole('complementary', { name: '주 메뉴' })).toBeVisible();
  const header = page.getByRole('banner');
  expect(Math.round((await header.boundingBox())!.height)).toBe(72);
  await expect(page.getByRole('searchbox', { name: '통합 검색' })).toBeVisible();
  await expect(header.getByRole('link', { name: '사용자 설정' })).toBeVisible();
  await expect(header.getByRole('button', { name: '로그아웃' })).toBeVisible();
  for (const name of ['메뉴 열기', '검색 열기', '계정 메뉴']) {
    await expect(page.getByRole('button', { name })).toBeHidden();
  }
});

test('1280px: 모달은 가운데 다이얼로그(시트 아님), 배경 잠금 없음', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await page.getByRole('button', { name: '저장된 화면·입력 초기화' }).click();
  const dialog = page.getByRole('dialog', { name: '저장된 화면·입력 초기화' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(Math.round(box.width)).toBe(520);
  // 가운데 — 좌우 여백이 같고 아래에 붙지 않는다
  expect(Math.abs(box.x - (1280 - box.x - box.width))).toBeLessThanOrEqual(1);
  expect(box.y + box.height).toBeLessThan(800 - 8);
  const lock = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
  expect(lock).not.toBe('hidden');
});

test('MOB-SR-101.4·102.3: 1280px 공유 견적서는 7열 표, 카드 숨김, 합계 패널은 고정되지 않음', async ({
  page,
  browser,
  baseURL,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await page.getByRole('list', { name: '품목 목록' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  await page.getByRole('button', { name: '견적 저장' }).click();
  await expect(page.getByTestId('active-quote')).toContainText(/Q-\d{4}-\d{4}/);
  const quoteNo = /Q-\d{4}-\d{4}/.exec(await page.getByTestId('active-quote').innerText())![0];
  await page.getByRole('button', { name: `${quoteNo} 견적 공유` }).click();
  const dialog = page.getByRole('dialog', { name: `견적 공유 · ${quoteNo}` });
  await dialog.getByRole('button', { name: '새 공유 링크 만들기' }).click();
  const path = await dialog.getByRole('link', { name: '열기' }).first().getAttribute('href');

  const guest = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const shared = await guest.newPage();
  await shared.goto(path!);
  const table = shared.getByRole('table', { name: '견적 품목 표' });
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(7);
  await expect(shared.getByRole('list', { name: '견적 품목' })).toBeHidden();
  const total = shared.getByRole('region', { name: '견적 합계' });
  expect(await total.evaluate((element) => getComputedStyle(element).position)).toBe('static');
  await guest.close();
});
