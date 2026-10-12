import { expect, test } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * QA-09 (PR-9) — 홈 · 공지 · 검색. 시드 공지 3건(중요 1)이 있고 globalSetup 이 판매단가 200행 픽스처를 적용해 둔다.
 * AC-50(카드 4개 → /pricing?major, 최근 5건·중요 배지) · AC-51(ADMIN CRUD 즉시 반영·감사, USER 버튼 없음) · AC-52(검색 결과 그룹)
 */
test.describe.configure({ mode: 'serial' });

const REASONLESS_TITLE = `E2E 공지 ${Date.now()}`;

test('AC-50: 홈 제품 카드 4개 → /pricing?major=…, 최근 공지 5건 이하·중요 배지·전체보기', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/');
  const cards = page.getByRole('link', { name: /가격 정책 보기/ });
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(2)).toHaveAttribute('href', '/pricing?family=iSIGN');
  const rows = page.getByRole('list', { name: '공지 목록' }).locator('li');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(5);
  await expect(
    page.getByRole('list', { name: '공지 목록' }).getByText('중요').first(),
  ).toBeVisible();
  await cards.first().click();
  await expect(page).toHaveURL(/\/pricing\?family=WAPPLES$/);
  // r5: family 만 있으면 드롭다운은 전체, 표 위 배지 "제품군: WAPPLES"
  await expect(page.getByRole('combobox', { name: '대분류' })).toHaveValue('전체');
  await expect(page.getByRole('status')).toContainText('제품군: WAPPLES');
  await page.goto('/');
  await page.getByRole('link', { name: '전체보기 →' }).click();
  await expect(page).toHaveURL(/\/notices$/);
  await expect(page.getByRole('heading', { level: 1, name: '공지사항' })).toBeVisible();
});

test('AC-51: USER 는 상세에 수정/삭제 버튼이 없고 /admin/notices 는 / 로', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/notices');
  await page.getByRole('list', { name: '공지 목록' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/notices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '수정' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제' })).toHaveCount(0);
  await page.goto('/admin/notices');
  await expect(page).toHaveURL((url) => url.pathname === '/');
});

test('AC-51: ADMIN 등록 → 홈·목록·상세 즉시 반영 → 수정 → 삭제 → 감사 로그', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/notices');
  await page.getByRole('button', { name: '+ 공지 등록' }).click();
  const dialog = page.getByRole('dialog', { name: '공지 등록' });
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(dialog.getByText('제목을 입력하세요')).toBeVisible();
  await dialog.getByLabel('제목').fill(REASONLESS_TITLE);
  await dialog.getByLabel('내용').fill('E2E 본문');
  await dialog.getByLabel('중요 공지로 표시').check();
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('status')).toContainText(`등록했습니다: ${REASONLESS_TITLE}`);
  const row = page
    .getByRole('table', { name: '공지 관리 표' })
    .locator('tbody tr')
    .filter({ hasText: REASONLESS_TITLE });
  await expect(row).toContainText('중요');

  await page.goto('/');
  await expect(page.getByRole('list', { name: '공지 목록' })).toContainText(REASONLESS_TITLE);
  await page.getByRole('link', { name: new RegExp(REASONLESS_TITLE) }).click();
  await expect(page.getByRole('heading', { level: 1, name: REASONLESS_TITLE })).toBeVisible();
  await expect(page.getByText('E2E 본문')).toBeVisible();

  await page.getByRole('button', { name: '수정' }).click();
  const edit = page.getByRole('dialog', { name: '공지 수정' });
  await edit.getByLabel('제목').fill(`${REASONLESS_TITLE} (수정)`);
  await edit.getByRole('button', { name: '저장' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `${REASONLESS_TITLE} (수정)` }),
  ).toBeVisible();

  await page.getByRole('button', { name: '삭제' }).click();
  await page
    .getByRole('dialog', { name: '공지 삭제' })
    .getByRole('button', { name: '삭제' })
    .click();
  await expect(page).toHaveURL(/\/notices$/);
  await expect(page.getByRole('list', { name: '공지 목록' })).not.toContainText(REASONLESS_TITLE);

  for (const action of ['notice.create', 'notice.update', 'notice.delete']) {
    await page.goto(`/admin/audit?action=${action}`);
    const audit = page
      .getByRole('table', { name: '감사 로그' })
      .getByRole('row')
      .filter({ hasText: REASONLESS_TITLE })
      .first();
    await expect(audit).toContainText('성공');
  }
});

test('AC-52: 상단 검색 "Wapples SA-500" → 품목·공지 결과 그룹, 품목 → /pricing?q=품번', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/');
  await page.getByRole('searchbox', { name: '통합 검색' }).fill('Wapples SA-500');
  await page.getByRole('searchbox', { name: '통합 검색' }).press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Wapples\+SA-500$/);
  await expect(page.getByRole('heading', { level: 2, name: /품목/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /공지사항/ })).toBeVisible();
  const item = page.getByRole('list', { name: '품목 결과' }).getByRole('link').first();
  await expect(item).toContainText('Wapples SA-500');
  await item.click();
  await expect(page).toHaveURL(/\/pricing\?q=P\d+$/);
  await expect(
    page.getByRole('table', { name: '가격정책 표' }).locator('tbody tr').first(),
  ).toContainText('Wapples SA-500');
});
