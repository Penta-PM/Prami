import path from 'node:path';

import { expect, test } from '@playwright/test';
import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * PRAMI-003 PR-1 (QA-1 ②⑦⑨) — 품목조회 다중 파일 업로드·제품군 병합 선택 UI, 계산기 STEP5 결합형.
 * globalSetup 이 판매단가 200행 + 합성 품목 마스터(items-v1, WAPPLES·D.AMO)를 적용해 둔다.
 */
const ROOT = path.resolve(process.cwd(), 'tests/fixtures');
const REDUCED = ['wapples', 'd-amo', 'isign', 'isgin-pki', 'cloudbric'].map((name) =>
  path.join(ROOT, 'items', `${name}.xlsx`),
);
const ITEM_INPUT = '품목조회 파일 업로드 (1~5개, 제품군별)';

/** items-v1 에서 WAPPLES 행만 남긴 파일 (D.AMO 가 빠져 병합 방식 선택이 필요하다) */
async function wapplesOnlyFile(outPath: string): Promise<string> {
  const [sheet] = await readXlsxFile(path.join(ROOT, 'imports', 'items-v1.xlsx'));
  const data = (sheet?.data ?? []) as unknown[][];
  const header = (data[1] ?? []).map((cell) => String(cell ?? '').trim());
  const major = header.indexOf('품목대분류');
  const rows = data.slice(2).filter((row) => row[major] === 'WAPPLES');
  const out: SheetData = [['품목조회'], header, ...rows].map((row) =>
    (row as unknown[]).map((value) => (value ?? null) as Cell),
  );
  await writeXlsxFile(out, { sheet: 'Sheet1' }).toFile(outPath);
  return outPath;
}

test('ADMIN: 품목조회 5파일 동시 업로드 → 파일 목록·검증 통과 / WAPPLES 만 업로드 → 병합 방식 선택 전 적용 비활성, 전량 교체 확인 모달, 병합 적용', async ({
  page,
}, testInfo) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  // globalSetup 이 품목 배치를 적용해 두었으므로 기본값은 "기존 파일 재사용" — 신규 업로드로 전환
  await page
    .getByRole('radiogroup', { name: '품목상태 파일 방식' })
    .getByRole('radio', { name: '신규 업로드' })
    .check();
  await page.getByLabel(ITEM_INPUT).setInputFiles(REDUCED);
  const summary = page.getByLabel(/wapples\.xlsx 외 4개 검증 결과/);
  await expect(summary).toContainText('검증 통과');
  await expect(
    summary.getByRole('list', { name: '업로드 파일' }).getByRole('listitem'),
  ).toHaveCount(5);
  await expect(summary).toContainText('개인정보 컬럼 3개');

  const file = await wapplesOnlyFile(testInfo.outputPath('wapples-only.xlsx'));
  await page.getByLabel(ITEM_INPUT).setInputFiles(file);
  await expect(page.getByLabel('wapples-only.xlsx 검증 결과')).toContainText('검증 통과');
  const merge = page.getByRole('group', { name: '품목 제품군 병합 방식' });
  await expect(merge).toContainText('D.AMO');
  const apply = page.getByRole('button', { name: '가격정책 적용' });
  await expect(apply).toBeDisabled();

  await merge.getByRole('radio', { name: '전량 교체' }).click();
  await apply.click();
  const modal = page.getByRole('dialog', { name: '품목 전량 교체' });
  await expect(modal).toContainText('품번 1개가 사라집니다');
  // AC-373 ③: 운영중 판매단가 행 증감 예상 (예: 2,428 → 3,644)
  await expect(modal.getByTestId('operating-delta')).toContainText(
    /운영중 판매단가 행은 [\d,]+ → [\d,]+/,
  );
  await modal.getByRole('button', { name: '취소' }).click();
  await expect(modal).toBeHidden();

  await merge.getByRole('radio', { name: '누락 제품군 유지 (병합)' }).click();
  await apply.click();
  await expect(page.getByText('적용 완료')).toBeVisible({ timeout: 30_000 });
});

test('USER: 계산기 STEP5 에 결합형 후보가 나온다 (품목 마스터 판정 K5)', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  const items = page.getByRole('list', { name: '품목 목록' }).getByRole('button');
  await items.filter({ hasText: 'Wapples SA-500' }).first().click();
  const bundles = page.getByRole('group', { name: 'STEP 5 · 결합형' });
  await expect(bundles).toContainText('Wapples 2200 T1 S/W v5.0 업그레이드');
  await expect(bundles).not.toContainText('결합형이 없습니다');
  // 결합형은 STEP3 품목 목록에 없다
  await expect(items.filter({ hasText: 'Wapples 2200 T1 S/W v5.0 업그레이드' })).toHaveCount(0);
});
