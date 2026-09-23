import { expect, type Page } from '@playwright/test';

import { E2E_ENV } from '../../playwright.config';

export const FIXTURE_ADMIN = 'fixture-admin@pentasecurity.com';
export const FIXTURE_USER = 'fixture-user@pentasecurity.com';

/** 테스트 Credentials 로 로그인한다 (AUTH_TEST_MODE). callbackUrl 이 있으면 그 경로로 돌아온다 */
export async function loginAs(page: Page, email: string, callbackUrl = '/'): Promise<void> {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await submitTestLogin(page, email, E2E_ENV.AUTH_TEST_PASSWORD);
  await expect(page).toHaveURL((url) => url.pathname === callbackUrl.split('?')[0]);
}

export async function submitTestLogin(page: Page, email: string, password: string) {
  const form = page.getByRole('form', { name: '테스트 계정 로그인' });
  await form.getByLabel('이메일').fill(email);
  await form.getByLabel('테스트 비밀번호').fill(password);
  await form.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
}
