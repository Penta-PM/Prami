import { expect, test } from '@playwright/test';

import { E2E_ENV } from '../../playwright.config';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs, submitTestLogin } from './helpers';

/**
 * QA-02 / AC-02~05 — AUTH_TEST_MODE Credentials 로그인 (Google 실 로그인은 OAuth 클라이언트 발급 후 수동 확인).
 * 같은 DB 를 바꾸므로 순서대로 실행한다.
 */
test.describe.configure({ mode: 'serial' });

test('AC-03: 비로그인으로 /pricing 접근 → /login 리다이렉트, Google 로그인 버튼이 있다', async ({
  page,
}) => {
  await page.goto('/pricing');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fpricing$/);
  await expect(page.getByRole('button', { name: 'Google 계정으로 로그인' })).toBeVisible();
  await expect(page.getByRole('form', { name: '테스트 계정 로그인' })).toBeVisible();
});

test('비로그인 API 호출은 401 봉투', async ({ request }) => {
  const response = await request.get('/api/audit/export.csv', { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
});

test('테스트 비밀번호가 틀리면 로그인 거부 문구', async ({ page }) => {
  await page.goto('/login');
  await submitTestLogin(page, FIXTURE_USER, 'wrong-password');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    '비밀번호가 올바르지 않습니다',
  );
  await expect(page).toHaveURL(/\/login/);
});

test('AC-02·AC-03·AC-04: USER 로그인 → 관리자 메뉴 없음, /admin 차단, 관리자 API 403', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing');
  await expect(page.getByRole('banner').getByText('픽스처 사용자')).toBeVisible();
  const nav = page.getByRole('complementary', { name: '주 메뉴' });
  await expect(nav.getByRole('link', { name: '가격 정책 조회' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '감사 로그' })).toHaveCount(0);

  await page.goto('/admin/policies');
  await expect(page).toHaveURL((url) => url.pathname === '/');

  const response = await page.request.get('/api/audit/export.csv');
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});

test('AC-02·AC-03: ADMIN 로그인 → 감사 로그에 USER 의 /admin 접근 거부(denied)가 보인다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/audit');
  await expect(page.getByRole('heading', { level: 1, name: '감사 로그' })).toBeVisible();

  await page.getByLabel('행위').selectOption('auth.access_denied');
  await page.getByLabel('사용자').fill(FIXTURE_USER);
  await page.getByRole('button', { name: '조회' }).click();
  await expect(page).toHaveURL(/action=auth\.access_denied/);

  const row = page
    .getByRole('table', { name: '감사 로그' })
    .getByRole('row')
    .filter({ hasText: '/admin/policies' })
    .first();
  await expect(row).toContainText(FIXTURE_USER);
  await expect(row).toContainText('거부');
});

test('AC-05: 역할 변경 → 감사 로그에 변경 전/후 역할·actor 가 기록되고 표에 보인다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const changeRole = async (role: 'USER' | 'ADMIN') => {
    await page.getByRole('button', { name: `${FIXTURE_USER} 수정` }).click();
    const dialog = page.getByRole('dialog', { name: '사용자 수정' });
    await dialog.getByLabel('역할').selectOption(role);
    await page.getByRole('button', { name: '저장' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row').filter({ hasText: FIXTURE_USER });
    await expect(row.getByText(role, { exact: true })).toBeVisible();
  };

  await changeRole('ADMIN');
  await changeRole('USER'); // 원상 복구 (다른 테스트·재실행 대비)

  await page.goto('/admin/audit?action=user.update');
  const rows = page.getByRole('table', { name: '감사 로그' }).getByRole('row');
  const promoted = rows.filter({ hasText: 'role: USER' }).filter({ hasText: 'role: ADMIN' });
  await expect(promoted.first()).toContainText(FIXTURE_ADMIN);
  await expect(promoted.first()).toContainText(`user · ${FIXTURE_USER}`);
  await expect(promoted.first()).toContainText('성공');
});

test('사용자 사전 등록 → 비활성화 → 해당 계정 로그인 거부 (auth.denied_inactive)', async ({
  page,
  browser,
}) => {
  const email = `e2e-${Date.now()}@pentasecurity.com`;
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');

  await page.getByRole('button', { name: '+ 사용자 추가' }).click();
  const dialog = page.getByRole('dialog', { name: '사용자 추가' });
  await dialog.getByLabel('이메일').fill(email);
  await dialog.getByLabel('부서').fill('QA팀');
  await page.getByRole('button', { name: '저장' }).click();
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('미로그인 · 사전 등록');

  await page.getByRole('button', { name: `${email} 비활성화` }).click();
  await page
    .getByRole('dialog', { name: '사용자 비활성화' })
    .getByRole('button', { name: '비활성화' })
    .click();
  await expect(row.getByText('비활성', { exact: true })).toBeVisible();

  const other = await browser.newPage();
  await other.goto('/login');
  await submitTestLogin(other, email, E2E_ENV.AUTH_TEST_PASSWORD);
  await expect(other.getByRole('main').getByRole('alert')).toContainText('비활성화된 계정입니다');
  await other.close();

  await page.goto('/admin/audit?action=auth.denied_inactive');
  await expect(page.getByRole('row').filter({ hasText: email }).first()).toContainText('거부');
});

test('ADMIN 은 감사 로그 CSV 를 내려받는다', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/audit');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'CSV 내보내기' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^audit-logs-\d{4}-\d{2}-\d{2}\.csv$/);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text.startsWith('\uFEFF일시,사용자,행위,대상')).toBe(true);
  expect(text).toContain('auth.login');
});

test('로그아웃하면 /login 으로 돌아가고 보호 경로는 다시 막힌다', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/calculator');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcalculator$/);
});
