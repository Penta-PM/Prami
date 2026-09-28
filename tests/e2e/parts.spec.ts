import path from 'node:path';

import { expect, test } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * QA-06 (PR-6) — 파츠 관리 · 솔루션 그룹. globalSetup 이 판매단가 200행 픽스처(WAPPLES 모델·N_ 파츠 포함)를 적용해 둔다.
 * AC-30(모델 선택 → 파츠 체크 → 저장 → 모델별 1행 그룹화) · AC-31(재선택 경고·전체 교체) · AC-32(엑셀 오류 목록)
 * · AC-33(그룹 CRUD, soft delete) · USER 차단
 */
test.describe.configure({ mode: 'serial' });

const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures/imports');
const GROUP_NAME = `E2E 그룹 ${Date.now()}`;

test('AC-30·31: 모델 선택 → N_51080 체크 → 저장 → 그룹화 표, 재선택 경고 → 교체 저장 → 삭제', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/parts?family=WAPPLES');
  await expect(page.getByRole('heading', { level: 1, name: '파츠 관리' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'WAPPLES' })).toHaveAttribute('aria-current', 'page');

  const modelList = page.getByRole('list', { name: '모델 목록' });
  const modelButton = modelList.getByRole('button').first();
  const modelName = (await modelButton.getAttribute('aria-label'))!.replace(/ \(P\d+\)$/, '');
  await modelButton.click();
  await page.getByRole('searchbox', { name: '파츠 검색' }).fill('N_51080');
  const parts = page.getByRole('group', { name: '파츠 목록' });
  await expect(parts.getByRole('checkbox')).toHaveCount(1);
  await parts.getByRole('checkbox').check();
  await expect(page.getByLabel('선택된 파츠')).toContainText('N_51080');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('저장했습니다 — 파츠 1건');

  const table = page.getByRole('table', { name: '등록된 매핑 표' });
  const row = table.locator('tbody tr').filter({ hasText: modelName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('N_51080');
  await expect(row).toContainText('(P10800011)');

  // 재선택 → 경고 → 다른 파츠로 교체 저장 (UNIQUE 위반 없이 1행 유지)
  await modelList
    .getByRole('button', { name: new RegExp(modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .first()
    .click();
  // Next 라우트 어나운서(role=alert)와 겹치지 않도록 본문 안에서 찾는다
  await expect(page.getByRole('main').getByRole('alert')).toContainText('이미 등록된 모델입니다');
  // 재선택 시 기존 파츠(N_51080)가 체크 상태로 복원된다 (PR-6 QA INFO-3) → 해제하고 N_51240 만 선택
  await expect(page.getByLabel('선택된 파츠')).toContainText('N_51080');
  await page.getByRole('searchbox', { name: '파츠 검색' }).fill('N_51080');
  await parts.getByRole('checkbox').uncheck();
  await page.getByRole('searchbox', { name: '파츠 검색' }).fill('N_51240');
  await parts.getByRole('checkbox').check();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('기존 매핑을 새 선택 1건으로 교체');
  await expect(table.locator('tbody tr').filter({ hasText: modelName })).toHaveCount(1);
  await expect(table.locator('tbody tr').filter({ hasText: modelName })).toContainText('N_51240');
  await expect(table.locator('tbody tr').filter({ hasText: modelName })).not.toContainText(
    'N_51080',
  );

  await page.goto('/admin/audit?action=part_mapping.save');
  await expect(
    page
      .getByRole('table', { name: '감사 로그' })
      .getByRole('row')
      .filter({ hasText: modelName })
      .first(),
  ).toContainText('성공');

  await page.goto('/admin/parts?family=WAPPLES');
  await table
    .locator('tbody tr')
    .filter({ hasText: modelName })
    .getByRole('button', { name: /매핑 삭제/ })
    .click();
  await page
    .getByRole('dialog', { name: '매핑 삭제' })
    .getByRole('button', { name: '삭제' })
    .click();
  await expect(page.getByRole('status')).toContainText('삭제했습니다');
  await expect(page.getByText('등록된 매핑이 없습니다.')).toBeVisible();
});

test('AC-32: 파츠 엑셀 업로드 → 존재하지 않는 품번은 오류 목록, 적용 불가', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/parts?family=WAPPLES');
  await page.getByRole('radio', { name: '엑셀 등록' }).click();
  await page.getByLabel('파츠 엑셀 업로드').setInputFiles(path.join(FIXTURES, 'parts-sample.xlsx'));
  const summary = page.getByLabel('parts-sample.xlsx 검증 결과');
  await expect(summary).toContainText('오류 있음');
  await expect(summary.getByRole('alert')).toContainText('NOPE-0000');
  await expect(summary.getByRole('table', { name: '미리보기 (상위 20행)' })).toContainText(
    'P10100014',
  );
  await expect(page.getByRole('button', { name: '매핑 적용' })).toBeDisabled();
});

test('AC-33: 그룹 생성 → 카드(항목 칩·현재 단가) → 수정 → 삭제(soft) → 감사', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/groups?family=WAPPLES');
  await page.getByRole('button', { name: '+ 그룹 생성' }).click();
  const dialog = page.getByRole('dialog', { name: '그룹 생성' });
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(dialog.getByText('그룹명을 입력하세요')).toBeVisible();
  await dialog.getByLabel('그룹명').fill(GROUP_NAME);
  const boxes = dialog.getByRole('group', { name: '상세 제품 목록' }).getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('status')).toContainText(`생성했습니다: ${GROUP_NAME}`);
  const card = page
    .getByRole('list', { name: '솔루션 그룹 목록' })
    .getByRole('listitem')
    .filter({ hasText: GROUP_NAME });
  await expect(card).toContainText('원');
  await expect(page.getByRole('link', { name: /WAPPLES/ })).toContainText('1');

  await card.getByRole('button', { name: `${GROUP_NAME} 수정` }).click();
  const edit = page.getByRole('dialog', { name: '그룹 수정' });
  await edit.getByLabel('그룹명').fill(`${GROUP_NAME} (수정)`);
  await edit.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('status')).toContainText('수정했습니다');
  await expect(page.getByRole('list', { name: '솔루션 그룹 목록' })).toContainText(
    `${GROUP_NAME} (수정)`,
  );

  await page.getByRole('button', { name: `${GROUP_NAME} (수정) 삭제` }).click();
  await page
    .getByRole('dialog', { name: '그룹 삭제' })
    .getByRole('button', { name: '삭제' })
    .click();
  await expect(page.getByRole('status')).toContainText('삭제했습니다');
  await expect(page.getByRole('list', { name: '솔루션 그룹 목록' })).not.toContainText(GROUP_NAME);

  for (const action of [
    'solution_group.create',
    'solution_group.update',
    'solution_group.delete',
  ]) {
    await page.goto(`/admin/audit?action=${action}`);
    await expect(
      page
        .getByRole('table', { name: '감사 로그' })
        .getByRole('row')
        .filter({ hasText: GROUP_NAME })
        .first(),
    ).toContainText('성공');
  }
});

test('USER: /admin/parts, /admin/groups 는 / 로 리다이렉트', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/pricing');
  await page.goto('/admin/parts');
  await expect(page).toHaveURL((url) => url.pathname === '/');
  await page.goto('/admin/groups');
  await expect(page).toHaveURL((url) => url.pathname === '/');
});
