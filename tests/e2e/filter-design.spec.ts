import { expect, test, type Locator, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * 빠른 필터 바 디자인 보정 PR-4 (docs table-filter-quickbar §7.1·§7.4).
 * - 넘침: 320·375·768·1280px 에서 가격 관리·원가 관리·감사 화면의 문서, 바, 페이지 필터 카드, 모든 필드 팝오버(+ "＋ N개 더")가
 *   scrollWidth ≤ clientWidth (가로 스크롤 없음).
 * - 원가 자재 피커: 검색 콤보박스에서 ↑↓ 로 활성 행 이동, Enter 로 선택 — 모달 폼은 제출되지 않는다(확정 Action 없음, 모달 유지).
 */

const WIDTHS = [320, 375, 768, 1280] as const;
const PAGES = [
  { path: '/admin/policies', table: '가격정책 관리 표' },
  { path: '/admin/costs', table: '원가 표' },
  { path: '/admin/audit', table: '감사 로그' },
] as const;

/** 요소의 가로 넘침 — scrollWidth ≤ clientWidth 이어야 한다 */
async function expectNoHorizontalOverflow(locator: Locator, what: string) {
  const sizes = await locator.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(
    sizes.scroll,
    `${what}: scrollWidth ${sizes.scroll} > clientWidth ${sizes.client}`,
  ).toBeLessThanOrEqual(sizes.client);
}

async function expectPageNoOverflow(page: Page, what: string) {
  await expectNoHorizontalOverflow(page.locator('html'), `${what} 문서`);
  const bars = page.locator('[data-quick-filter-bar]');
  for (let i = 0; i < (await bars.count()); i += 1) {
    await expectNoHorizontalOverflow(bars.nth(i), `${what} 바`);
  }
  // 바를 감싸는 그룹(페이지 필터가 있으면 같은 카드)
  const groups = page.locator(
    '[role="group"]:has(> [data-quick-filter-bar]), [role="group"][data-quick-filter-bar]',
  );
  for (let i = 0; i < (await groups.count()); i += 1) {
    await expectNoHorizontalOverflow(groups.nth(i), `${what} 카드`);
  }
}

/** 바의 필드 버튼·"＋ N개 더" 를 하나씩 열어 팝오버 넘침을 본다 */
async function expectPopoversNoOverflow(page: Page, what: string) {
  const bar = page.locator('[data-quick-filter-bar]').first();
  const triggers = bar.locator('[data-quick-field], [data-quick-filter-more]');
  const count = await triggers.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const trigger = triggers.nth(i);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const dialog = page.locator('[role="dialog"]:not([aria-modal])').last();
    await expect(dialog).toBeVisible();
    const name = (await dialog.getAttribute('aria-label')) ?? `팝오버 ${i}`;
    await expectNoHorizontalOverflow(dialog, `${what} ${name}`);
    // 팝오버가 화면 밖으로 나가지 않는다
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
}

for (const width of WIDTHS) {
  test(`넘침 0 — ${width}px: 가격 관리·원가 관리·감사 바·카드·팝오버 (§7.1)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loginAs(page, FIXTURE_ADMIN, '/admin/costs');
    for (const { path, table } of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('table', { name: table })).toBeVisible();
      const what = `${width}px ${path}`;
      await expectPageNoOverflow(page, what);
      await expectPopoversNoOverflow(page, what);
    }
  });
}

test('원가 자재 피커: ↑↓ 이동·Enter 선택, Enter 로 모달 폼이 제출되지 않는다 (§7.4)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs/links');
  const candidates = page.getByRole('table', { name: '원가 매핑 후보' });
  await expect(candidates).toBeVisible();
  await candidates
    .getByRole('button', { name: / 직접 선택$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: '원가 직접 선택' });
  await expect(dialog).toBeVisible();

  const combo = dialog.getByRole('combobox', { name: '자재명·자재번호 검색' });
  const list = dialog.getByRole('listbox', { name: /원가 자재/ });
  await expect(combo).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!);
  const options = list.getByRole('option');
  expect(await options.count()).toBeGreaterThan(1);
  expect(await options.count()).toBeLessThanOrEqual(201);

  await combo.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const activeId = await combo.getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  await page.keyboard.press('ArrowUp');
  const upId = await combo.getAttribute('aria-activedescendant');
  expect(upId).toBeTruthy();
  expect(upId).not.toBe(activeId);

  await page.keyboard.press('Enter');
  // 선택만 바뀌고 모달은 그대로(제출 없음), 포커스도 검색창
  await expect(dialog).toBeVisible();
  await expect(combo).toBeFocused();
  await expect(list.locator(`[id="${upId}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option', { selected: true })).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: '확정' })).toBeEnabled();

  // 검색 → 결과 수·결과 없음 문구
  await combo.fill('존재하지-않는-자재-zzzz');
  await expect(dialog.getByText('검색 결과가 없습니다')).toBeVisible();

  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toBeHidden();
});
