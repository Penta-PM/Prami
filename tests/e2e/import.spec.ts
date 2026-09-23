import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * QA-03 (PR-3) — 가격정책 관리 ImportPanel: 업로드 → 미리보기/오류 → 가격정책 적용 → 현재 적용 배지.
 * E2E DB 는 실행 간 유지되므로 같은 파일 재업로드(409)는 "기존 파일 선택"으로 이어간다.
 */
test.describe.configure({ mode: 'serial' });

const fixture = (name: string) => path.resolve(process.cwd(), 'tests/fixtures/imports', name);

async function uploadSales(page: Page, name: string) {
  const row = page.getByRole('region', { name: '가격정책 파일 적용' });
  const salesMode = row.getByRole('radiogroup', { name: '판매단가 파일 방식' });
  await salesMode.getByRole('radio', { name: '신규 업로드' }).click();
  await page.getByLabel('판매단가 엑셀 업로드').setInputFiles(fixture(name));
}

test('ADMIN: 200행 픽스처 업로드 → 미리보기 → 적용 → 현재 적용 배지 (AC-20/24)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  await expect(page.getByRole('heading', { level: 1, name: '가격정책 관리' })).toBeVisible();
  await uploadSales(page, 'sales-200.xlsx');

  const summary = page.getByLabel('sales-200.xlsx 검증 결과');
  const conflict = page.getByRole('button', { name: '기존 파일 선택' });
  await expect(summary.or(conflict)).toBeVisible();
  if (await conflict.isVisible()) {
    await conflict.click();
  } else {
    await expect(summary.getByText('검증 통과')).toBeVisible();
    await expect(summary.getByRole('table', { name: '미리보기 (상위 20행)' })).toBeVisible();
  }

  await page.getByRole('button', { name: '가격정책 적용' }).click();
  const done = page.getByRole('status', { name: '적용 완료' });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText('ERP 적재 행');
  await expect(done).toContainText('200');
  await expect(page.getByLabel('현재 적용')).toContainText('sales-200.xlsx');
});

test('ADMIN: 헤더 누락 파일은 실패로 표시되고 적용할 수 없다 (AC-25)', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  await uploadSales(page, 'sales-header-missing.xlsx');
  const summary = page.getByLabel('sales-header-missing.xlsx 검증 결과');
  await expect(summary).toBeVisible();
  await expect(summary.getByText('실패')).toBeVisible();
  await expect(summary.getByRole('alert')).toContainText('단가(1코어)');
  await expect(page.getByRole('button', { name: '가격정책 적용' })).toBeDisabled();
});

test('USER 는 가격정책 관리·임포트 API 에 접근할 수 없다', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/');
  await page.goto('/admin/policies');
  await expect(page).toHaveURL((url) => url.pathname === '/');
  const response = await page.request.post('/api/imports/sales', {
    multipart: {
      file: { name: 'x.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') },
    },
  });
  expect(response.status()).toBe(403);
});
