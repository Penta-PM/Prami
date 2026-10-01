import { expect, test } from '@playwright/test';

import { REAL_LOGIN_BASE_URL } from '../../playwright.config';

/**
 * AC-335 (PRAMI-003 §4.9.4 T-1): `AUTH_TEST_MODE` 없이 `AUTH_GOOGLE_ID`/`SECRET`(더미 값)만 있는 로컬 설정으로 기동하면
 * `/login` 에 Google 버튼만 있고 테스트 계정 폼·TEST MODE 배너가 없다. 실 Google 호출은 하지 않는다(페이지 렌더만).
 */
test('테스트 모드 없는 로컬 설정: /login 에 Google 버튼만, 테스트 폼·TEST MODE 배너 없음', async ({
  page,
}) => {
  await page.goto(`${REAL_LOGIN_BASE_URL}/login`);
  const google = page.getByRole('button', { name: 'Google 계정으로 로그인' });
  await expect(google).toBeVisible();
  await expect(google).toBeEnabled();
  await expect(page.getByRole('form', { name: '테스트 계정 로그인' })).toHaveCount(0);
  await expect(page.getByText('TEST MODE', { exact: true })).toHaveCount(0);
  await expect(page.getByText('AUTH_GOOGLE_ID/SECRET')).toHaveCount(0);
});

test('테스트 모드 없는 서버는 테스트 Credentials 공급자가 없다', async ({ request }) => {
  const providers = await (await request.get(`${REAL_LOGIN_BASE_URL}/api/auth/providers`)).json();
  expect(Object.keys(providers as Record<string, unknown>)).toEqual(['google']);
});
