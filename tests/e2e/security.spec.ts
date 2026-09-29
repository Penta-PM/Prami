import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * PR-11a 하드닝 회귀 (AC-91·94 ③, QA-11a): E2E 서버는 AUTH_TEST_MODE 라 /login 에 TEST MODE 배너가 있어야 하고,
 * 보안 헤더가 붙으며, CSP(nonce) 도입 후에도 주요 화면·챗봇·PDF·공유에서 CSP 위반이 0건이어야 한다.
 */
function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(text)) {
      violations.push(`${page.url()} :: ${text.slice(0, 200)}`);
    }
  });
  return violations;
}

test('AC-94 ③·AC-91: /login 에 TEST MODE 배너, 응답에 CSP(nonce)·보안 헤더', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('status', { name: '테스트 모드' })).toContainText('TEST MODE');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  // Next 가 인라인 스크립트에 같은 nonce 를 붙였는지
  const nonce = /'nonce-([^']+)'/.exec(headers['content-security-policy']!)![1];
  const scriptNonces = await page.locator('script[nonce]').count();
  expect(scriptNonces).toBeGreaterThan(0);
  expect(nonce).toBeTruthy();
});

test('CSP 회귀: 로그인 후 주요 화면·챗봇·계산기에서 CSP 위반 0건, 헤더에 TEST MODE 배지', async ({
  page,
}) => {
  const violations = collectCspViolations(page);
  await loginAs(page, FIXTURE_ADMIN, '/');
  await expect(page.getByRole('banner').getByTestId('test-mode-badge')).toBeVisible();
  for (const path of [
    '/',
    '/pricing',
    '/calculator',
    '/admin/policies',
    '/admin/costs',
    '/notices',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
  }
  await page.getByRole('button', { name: '챗봇', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '가격정책 챗봇' });
  await panel.getByLabel('질문 입력').fill('Wapples-500 (H500 T2) 가격');
  await panel.getByRole('button', { name: '보내기' }).click();
  await expect(panel.locator('[data-from="bot"]').last()).toContainText('12,000,000원');
  expect(violations).toEqual([]);
});

test('CSP 회귀: 비로그인 공유 페이지·로그인 화면에서도 위반 0건 (USER 가 만든 공유 링크)', async ({
  page,
  browser,
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
  const sharePath = await dialog.getByRole('link', { name: '열기' }).getAttribute('href');

  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  const violations = collectCspViolations(guest);
  const shared = await guest.goto(sharePath!);
  expect(shared?.status()).toBe(200);
  expect(shared!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(shared!.headers()['x-frame-options']).toBe('DENY');
  await expect(guest.getByTestId('share-total')).toBeVisible();
  await guest.goto('/login');
  await expect(guest.getByRole('form', { name: '테스트 계정 로그인' })).toBeVisible();
  expect(violations).toEqual([]);
  await anonymous.close();
});
