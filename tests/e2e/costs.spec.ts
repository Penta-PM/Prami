import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * QA-05 (PR-5) — 원가 관리. globalSetup 이 costs-dup 픽스처(7행, 같은 날짜 중복 포함)를 적용해 둔다.
 * AC-40(화면·탭·날짜 두 모드 URL) · AC-41(USER 차단: 페이지 리다이렉트 + 감사 denied) · 수정/삭제(사유 필수)
 */
test.describe.configure({ mode: 'serial' });

const HEADERS = [
  '원자재 코드',
  '원자재명',
  '분류',
  '원가',
  '적용시작일',
  '적용기간',
  '상태',
  '관리',
];

const headerTexts = (page: Page) =>
  page.getByRole('table', { name: '원가 표' }).locator('thead th').allInnerTexts();

test('ADMIN: 헤더·현재 적용·제품군 탭·연도 칩·적용기간 기준 → URL 유지 (AC-40, 요구 14)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs');
  await expect(page.getByRole('heading', { level: 1, name: '원가 관리' })).toBeVisible();
  await expect(page.getByLabel('현재 적용')).toContainText('costs-dup.xlsx');
  expect(await headerTexts(page)).toEqual(HEADERS);

  const tabs = page.getByRole('navigation', { name: '제품군' });
  await expect(tabs.getByRole('link')).toHaveText([/전체/, /WAPPLES/, /D\.AMO/, /iSIGN/]);
  await tabs.getByRole('link', { name: /iSIGN/ }).click();
  await expect(page).toHaveURL(/family=iSIGN/);
  const codes = await page
    .getByRole('table', { name: '원가 표' })
    .locator('tbody tr td:nth-child(1)')
    .allInnerTexts();
  expect(codes.length).toBeGreaterThan(0);
  expect(codes.every((code) => code.startsWith('W4'))).toBe(true);

  await page.getByRole('button', { name: '2025', exact: true }).click();
  await expect(page).toHaveURL(/family=iSIGN&from=2025-01-01&to=2025-12-31/);
  const starts = await page
    .getByRole('table', { name: '원가 표' })
    .locator('tbody tr td:nth-child(5)')
    .allInnerTexts();
  expect(starts.length).toBe(2);
  expect(starts.every((text) => text.startsWith('2025-'))).toBe(true);

  await page.getByRole('radio', { name: '적용기간 기준' }).click();
  await expect(page).toHaveURL(/dateMode=period/);
  await page.reload();
  await expect(page.getByRole('radio', { name: '적용기간 기준' })).toBeChecked();
  await expect(page.getByText(/총 [\d,]+건/)).toBeVisible();
});

test('ADMIN: 수정(사유 필수 → manual) → 삭제 → 감사 로그 (§4.5.5)', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs?q=W10100016');
  const table = page.getByRole('table', { name: '원가 표' });
  const row = table.locator('tbody tr').filter({ hasText: '2024-01-01' }).first();
  const name = (await row.locator('td:nth-child(2)').innerText()).replace(/\s*수동$/, '').trim();

  await row.getByRole('button', { name: `${name} 수정` }).click();
  const dialog = page.getByRole('dialog', { name: '원가 수정' });
  await dialog.getByLabel('원가 (KRW) *').fill('123456');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(dialog.getByText('변경 사유를 입력하세요')).toBeVisible();
  await dialog.getByLabel('변경 사유 * (감사 로그에 기록됩니다)').fill('E2E 수정');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('status')).toContainText('수정했습니다');

  await page.goto('/admin/costs?q=W10100016');
  const edited = table.locator('tbody tr').filter({ hasText: '123,456원' }).first();
  await expect(edited).toContainText('수동');

  await edited.getByRole('button', { name: `${name} 삭제` }).click();
  const del = page.getByRole('dialog', { name: '원가 삭제' });
  await del.getByRole('button', { name: '삭제' }).click();
  await expect(del.getByRole('alert')).toContainText('변경 사유를 입력하세요');
  await del.getByLabel('변경 사유 * (감사 로그에 기록됩니다)').fill('E2E 정리');
  await del.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByRole('status')).toContainText('삭제했습니다');

  // 감사 표에는 사유 컬럼이 없고(CSV 에만) 대상·전/후 스냅샷·결과가 보인다
  await page.goto('/admin/audit?action=material_cost.update');
  const audit = page
    .getByRole('table', { name: '감사 로그' })
    .getByRole('row')
    .filter({ hasText: 'W10100016' })
    .first();
  await expect(audit).toContainText('source: manual');
  await expect(audit).toContainText('unitCost: 123456.00');
  await expect(audit).toContainText('성공');
});

test('USER: /admin/costs → / 리다이렉트, 메뉴 없음, 감사 denied (AC-41, §4.7.1)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing');
  const nav = page.getByRole('complementary', { name: '주 메뉴' });
  await expect(nav.getByRole('link', { name: '원가 관리' })).toHaveCount(0);
  await page.goto('/admin/costs');
  await expect(page).toHaveURL((url) => url.pathname === '/');
});

test('ADMIN: 감사 로그에 USER 의 /admin/costs 거부가 남는다 (AC-41, §4.7.1)', async ({ page }) => {
  // 1차(proxy)에서 막히므로 페이지 거부는 auth.access_denied 로 남는다 (행위 키 없는 페이지 접근)
  await loginAs(page, FIXTURE_ADMIN, '/admin/audit?action=auth.access_denied');
  const denied = page
    .getByRole('table', { name: '감사 로그' })
    .getByRole('row')
    .filter({ hasText: '/admin/costs' })
    .first();
  await expect(denied).toContainText(FIXTURE_USER);
  await expect(denied).toContainText('거부');
});
