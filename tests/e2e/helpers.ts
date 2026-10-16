import { expect, type Page } from '@playwright/test';

import { E2E_ENV } from '../../playwright.config';

export const FIXTURE_ADMIN = 'fixture-admin@pentasecurity.com';
export const FIXTURE_USER = 'fixture-user@pentasecurity.com';

/**
 * 하이드레이션 카나리 (Linux 하이드레이션 수정 스펙 §3.5). 'use client' 컴포넌트가 SSR 과 다른 문자열을 렌더하면
 * React 가 recoverable error 를 콘솔에 찍고 트리를 다시 그린다 — dev 서버에서는 오류 오버레이가 클릭을 가로막아
 * "요소는 있는데 반응이 없는" 실패(company-key-warning.spec:137)로만 드러났다. 감지 즉시 던져 원인이 보이게 한다.
 */
const HYDRATION_PATTERN =
  /hydration failed|hydration mismatch|text content does not match|did not match/i;
const watchedPages = new WeakMap<Page, string[]>();

export function watchHydration(page: Page): string[] {
  const existing = watchedPages.get(page);
  if (existing) return existing;
  const errors: string[] = [];
  watchedPages.set(page, errors);
  const record = (text: string) => {
    if (!HYDRATION_PATTERN.test(text)) return;
    errors.push(text);
    // 리스너 안의 예외는 Playwright 가 실행 중인 테스트의 실패로 돌린다
    throw new Error(`하이드레이션 오류가 감지되었습니다 (${page.url()}):\n${text.slice(0, 600)}`);
  };
  page.on('console', (message) => {
    if (message.type() === 'error') record(message.text());
  });
  page.on('pageerror', (error) => record(error.message));
  return errors;
}

/** 지금까지 감지된 하이드레이션 오류가 없어야 한다 (loginAs 가 끝날 때, 필요하면 스펙에서 직접 호출) */
export function expectNoHydrationErrors(page: Page): void {
  expect(watchedPages.get(page) ?? [], '하이드레이션 오류 0건').toEqual([]);
}

/** 테스트 Credentials 로 로그인한다 (AUTH_TEST_MODE). callbackUrl 이 있으면 그 경로로 돌아온다 */
export async function loginAs(page: Page, email: string, callbackUrl = '/'): Promise<void> {
  watchHydration(page);
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await submitTestLogin(page, email, E2E_ENV.AUTH_TEST_PASSWORD);
  await expect(page).toHaveURL((url) => url.pathname === callbackUrl.split('?')[0]);
  expectNoHydrationErrors(page);
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
 * `/login` 이 이전 사용자 화면으로 돌아가는 경쟁이 있었다. 네트워크가 잠잠해진 뒤 빈 페이지로 떠나 진행 중인 요청을 끊고 지운다.
 */
export async function signOutLocally(page: Page): Promise<void> {
  // #52 QA: 서버 액션 뒤 이어지는 RSC 새로고침(GET ?_rsc=)이 아직 진행 중이면 쿠키를 지운 뒤 도착한 응답이 세션 쿠키를 다시 심는다.
  // 1) 네트워크가 잠잠해지기를 기다린다(알림 폴링은 60초 간격이라 막지 않는다). 단 Playwright 의 networkidle 은 페이지 로드마다
  //    한 번 도달하면 고정이라(이미 idle 이었으면 진행 중 요청을 기다리지 않음) 이것만으로는 결정적이지 않다(#52 QA 백로그 1).
  // 2) 빈 페이지로 떠나 남은 요청을 끊고 쿠키를 지운 뒤, 늦게 도착한 응답이 쿠키를 되살렸으면 한 번 더 지운다(되살아남이 멈출 때까지, 상한 5회).
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.goto('about:blank');
  const context = page.context();
  await context.clearCookies();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(300);
    if ((await context.cookies()).length === 0) return;
    await context.clearCookies();
  }
}
