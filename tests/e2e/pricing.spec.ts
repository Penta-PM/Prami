import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * QA-04 (PR-4) — 가격정책 조회·관리. globalSetup 이 원본 200행 픽스처를 적용해 둔다.
 * AC-10(날짜 필터·URL 유지) · AC-11(분류) · AC-12(헤더) · AC-13(라벨) · AC-15/16(등록·사유·드로어) · 삭제
 */
test.describe.configure({ mode: 'serial' });

const VIEW_HEADERS = [
  '단가 유형',
  '대분류',
  '중분류',
  '소분류',
  '품목명',
  '판매가',
  '적용기간',
  '품목상태',
  '상태',
  '비고',
];
const ADMIN_HEADERS = [
  '단가 유형',
  '대분류',
  '중분류',
  '소분류',
  '품목명',
  '판매가',
  '적용시작일',
  '적용기간',
  '운영 연도',
  '품목상태',
  '상태',
  '비고',
  '관리',
];

const headerTexts = (page: Page, name: string) =>
  page.getByRole('table', { name }).locator('thead th').allInnerTexts();

test('USER 조회: 헤더 순서, 연도 칩(적용시작일 기준) → URL·결과, 새로고침 유지 (AC-10·12)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing');
  await expect(page.getByRole('heading', { level: 1, name: '가격 정책 조회' })).toBeVisible();
  expect(await headerTexts(page, '가격정책 표')).toEqual(VIEW_HEADERS);

  const chip = page.getByRole('button', { name: '2024', exact: true });
  await chip.click();
  await expect(page).toHaveURL(/from=2024-01-01&to=2024-12-31/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const periods = await page
    .getByRole('table', { name: '가격정책 표' })
    .locator('tbody tr td:nth-child(7)')
    .allInnerTexts();
  expect(periods.length).toBeGreaterThan(0);
  expect(periods.every((text) => text.startsWith('2024-'))).toBe(true);

  await page.reload();
  await expect(page.getByRole('button', { name: '2024', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('radio', { name: '적용기간 기준' }).click();
  await expect(page).toHaveURL(/dateMode=period/);
  await expect(page.getByText(/총 [\d,]+건/)).toBeVisible();
});

test('USER 조회: 대분류 선택 → URL, 품목 마스터 없으면 중/소분류 비활성 안내 (AC-11)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing');
  const major = page.getByLabel('대분류');
  const options = await major.locator('option').allInnerTexts();
  expect(options[0]).toBe('전체');
  await major.selectOption(options[1]!);
  await expect(page).toHaveURL(new RegExp(`major=${encodeURIComponent(options[1]!)}`));
  const majors = await page
    .getByRole('table', { name: '가격정책 표' })
    .locator('tbody tr td:nth-child(2)')
    .allInnerTexts();
  expect(majors.every((text) => text === options[1])).toBe(true);
});

test('USER 조회: 행 클릭 → 행 상세 드로어(원본 20컬럼·계열 이력), 관리 컬럼·등록 버튼 없음', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing?q=P2002030005');
  await expect(page.getByRole('button', { name: '+ 등록' })).toHaveCount(0);
  await page.getByRole('table', { name: '가격정책 표' }).locator('tbody tr').first().click();
  const drawer = page.getByRole('dialog', { name: '행 상세' });
  const source = drawer.getByRole('region', { name: '원본 20컬럼' });
  await expect(source.getByRole('term')).toHaveCount(20);
  await expect(
    drawer.getByRole('region', { name: '계열 이력' }).locator('li').first(),
  ).toBeVisible();
});

test('ADMIN 관리: 헤더(적용시작일·운영 연도·관리), 등록(사유 필수) → manual 행 → 삭제 (AC-12·13·15·16)', async ({
  page,
}) => {
  const code = `E2E-${Date.now()}`;
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  expect(await headerTexts(page, '가격정책 관리 표')).toEqual(ADMIN_HEADERS);

  await page.getByRole('button', { name: '+ 등록' }).click();
  const dialog = page.getByRole('dialog', { name: '가격정책 등록' });
  await dialog.getByLabel('제품군 *').fill('WAPPLES');
  await dialog.getByLabel('품번 *').fill(code);
  await dialog.getByLabel('품명 *').fill('E2E 모델');
  await dialog.getByLabel('단가 *').fill('1500000');
  await dialog.getByLabel('적용시작일 *').fill('2025-04-01');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(dialog.getByText('변경 사유를 입력하세요')).toBeVisible();

  await dialog.getByLabel('변경 사유 * (감사 로그에 기록됩니다)').fill('E2E 등록');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('status')).toContainText('등록했습니다');

  await page.goto(`/admin/policies?q=${code}`);
  const row = page.getByRole('table', { name: '가격정책 관리 표' }).locator('tbody tr').first();
  await expect(row).toContainText('1,500,000원');
  await expect(row).toContainText('2025-04-01 ~ 현재');
  await expect(row).toContainText('2025 ~ 현재');
  await expect(row).toContainText('미확인');
  await expect(row).toContainText('운영중');

  await row.getByRole('button', { name: 'E2E 모델 삭제' }).click();
  const del = page.getByRole('dialog', { name: '가격정책 삭제' });
  await del.getByLabel('변경 사유 * (감사 로그에 기록됩니다)').fill('E2E 정리');
  await del.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByRole('status')).toContainText('삭제했습니다');
  await expect(page.getByText('검색 결과가 없습니다.')).toBeVisible();

  await page.goto('/admin/audit?action=price_policy.create');
  await expect(page.getByRole('row').filter({ hasText: code }).first()).toContainText('성공');
});
