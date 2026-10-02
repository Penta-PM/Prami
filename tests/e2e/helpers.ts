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

/**
 * 다른 계정으로 바꿔 로그인하기 전 로그아웃 (PRAMI-003 PR-4, AC-374 원인 분석). 쿠키만 지우면 화면이 띄운 백그라운드 요청
 * (챗봇 상태 조회 등 — 콜드 dev 서버에서 느림)이 그 뒤에 끝나며 Auth.js 슬라이딩 세션의 Set-Cookie 로 세션을 되살려
 * `/login` 이 이전 사용자 화면으로 돌아가는 경쟁이 있었다. 먼저 빈 페이지로 떠나 진행 중인 요청을 끊고 지운다.
 */
export async function signOutLocally(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.context().clearCookies();
}
