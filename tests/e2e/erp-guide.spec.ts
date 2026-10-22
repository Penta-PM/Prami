import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * ERP 업로드 안내 (erp-upload-guide §2·§6): 가격정책 관리 업로드 패널 맨 위 "PRAMI ERP 데이터" 버튼 → 공통 설명 팝오버,
 * 칸별 ⓘ 키보드 열기·Esc 포커스 복귀, 마우스 이탈 닫힘, 팝오버 axe(대비 포함) 위반 0, 375px 에서 좌우 16px 안,
 * 원가 매핑 화면 항목 4 ⓘ.
 */
async function expectNoAxeViolations(page: Page, selector: string) {
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  expect(
    axe.violations,
    JSON.stringify(axe.violations.map((v) => [v.id, v.nodes.map((n) => n.html)])),
  ).toEqual([]);
  expect(
    axe.passes.filter((rule) => rule.id === 'color-contrast').flatMap((rule) => rule.nodes).length,
    'axe 가 대비를 검사한 요소',
  ).toBeGreaterThan(0);
}

test('ADMIN: ERP 안내 버튼·칸별 ⓘ — 키보드 열기, Esc 포커스 복귀, 마우스 이탈 닫힘, axe 0, 375px', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  const panel = page.getByRole('region', { name: '가격정책 파일 적용' });
  const guide = panel.getByRole('button', { name: 'PRAMI ERP 데이터' });
  await expect(guide).toBeVisible();
  await expectNoAxeViolations(page, 'section[aria-label="가격정책 파일 적용"]');

  // 키보드: 공통 설명 열기 → 본문(두 줄) → axe → Esc 로 닫고 버튼으로 포커스
  await guide.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'PRAMI ERP 데이터' });
  await expect(dialog).toBeVisible();
  await expect(guide).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog).toContainText('아래 내용에 대해 ERP에서 조회한 후');
  await expect(dialog.getByRole('listitem')).toHaveCount(4);
  await expect(dialog.locator('strong')).toHaveText('[EXCEL로 전송하기]');
  await expectNoAxeViolations(page, '[role="dialog"][aria-label="PRAMI ERP 데이터"]');
  // 키보드로 연 경우 마우스 이동으로 닫히지 않는다
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(guide).toBeFocused();

  // 칸별 ⓘ: Space 로 열기 → Esc → 포커스 복귀
  const salesHint = panel.getByRole('button', { name: '판매단가 파일 ERP 메뉴 경로' });
  await salesHint.focus();
  await page.keyboard.press('Space');
  const salesDialog = page.getByRole('dialog', { name: '판매단가 파일 ERP 메뉴 경로' });
  await expect(salesDialog).toContainText('가격정책 관리 품목 업데이트');
  await expect(salesDialog).toContainText('기본정보 > 품목단가 > 판매단가등록');
  await page.keyboard.press('Escape');
  await expect(salesDialog).toBeHidden();
  await expect(salesHint).toBeFocused();

  // 마우스: hover 로는 열리지 않고, 클릭으로 연 뒤 영역을 벗어나면 닫힌다
  const itemsHint = panel.getByRole('button', { name: '품목상태 파일 ERP 메뉴 경로' });
  await itemsHint.hover();
  await page.waitForTimeout(300);
  await expect(itemsHint).toHaveAttribute('aria-expanded', 'false');
  await itemsHint.click();
  const itemsDialog = page.getByRole('dialog', { name: '품목상태 파일 ERP 메뉴 경로' });
  await expect(itemsDialog).toContainText('기본정보 > 품목 > 품목조회');
  await page.mouse.move(5, 5);
  await expect(itemsDialog).toBeHidden();
  await expect(itemsHint).toBeFocused();

  // 375px: 팝오버가 좌우 16px 안, 가로 스크롤 없음
  await page.setViewportSize({ width: 375, height: 740 });
  await guide.scrollIntoViewIfNeeded();
  await guide.click();
  // 등장 모션(scaleIn)이 끝난 뒤의 상자로 본다 — 애니메이션 중에는 축소된 상자가 잡힌다
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return box.x >= 16 && box.x + box.width <= 375 - 16;
    })
    .toBe(true);
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });

  // 원가 매핑 화면 — 항목 4 ⓘ (공통 설명 버튼 없음)
  await page.goto('/admin/costs/links');
  const linkHint = page.getByRole('button', { name: '원가 매핑 ERP 메뉴 경로' });
  await expect(linkHint).toBeVisible();
  await expect(page.getByRole('button', { name: 'PRAMI ERP 데이터' })).toHaveCount(0);
  await linkHint.click();
  await expect(page.getByRole('dialog', { name: '원가 매핑 ERP 메뉴 경로' })).toContainText(
    '기본정보 > 품목 > 품목조회(추가정보)',
  );
});
