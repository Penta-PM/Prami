import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * PRAMI-003 AC-375 (PR #22 L-2·I-11·I-14): ① axe `color-contrast` 위반 0 — `/settings#llm`·`/admin/policies`
 * (보조 텍스트 `text-tertiary`·카드 설명 포함) ② 320px 에서 사이드바가 오버레이라 `main` 폭 ≥ 288px, 문서 가로 스크롤 0.
 */
async function contrastViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  // axe 가 규칙을 건너뛰면(예: "Element midpoint exceeds the grid bounds" — 스크롤 영역 밖 요소) 위반 0 이 거짓 통과가 된다
  const errored = results.incomplete.filter((rule) => 'error' in rule);
  expect(
    errored.map((rule) => rule.id),
    'axe 규칙 실행 오류',
  ).toEqual([]);
  expect(results.passes.flatMap((rule) => rule.nodes).length, 'axe 가 검사한 요소').toBeGreaterThan(
    20,
  );
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${node.target.join(' ')} :: ${node.failureSummary ?? ''}`),
  );
}

for (const [path, hash] of [
  ['/settings', '#llm'],
  ['/admin/policies', ''],
] as const) {
  test(`AC-375 ①: ${path}${hash} color-contrast 위반 0`, async ({ page }) => {
    // 본문(main)이 자체 스크롤이라 화면 밖 요소에서 axe 가 규칙을 중단한다 — 본문 전체가 들어가는 높이로 검사
    await page.setViewportSize({ width: 1280, height: 4000 });
    await loginAs(page, FIXTURE_ADMIN, path);
    if (hash) await page.goto(`${path}${hash}`);
    await page.waitForLoadState('networkidle');
    expect(await contrastViolations(page)).toEqual([]);
  });
}

test('AC-375 ②: 320px — 사이드바는 오버레이, main ≥ 288px, 가로 스크롤 0, 메뉴로 이동 가능', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await loginAs(page, FIXTURE_ADMIN, '/');
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  expect((await main.boundingBox())!.width).toBeGreaterThanOrEqual(288);
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

  const sidebar = page.getByRole('complementary', { name: '주 메뉴' });
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('link', { name: '가격 정책 조회' }).click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(sidebar).toBeHidden();
  expect((await page.getByRole('main').boundingBox())!.width).toBeGreaterThanOrEqual(288);
});

test('AC-375 ②: 데스크톱(1280px) 사이드바는 그대로 레이아웃에 있다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, FIXTURE_ADMIN, '/');
  await expect(page.getByRole('complementary', { name: '주 메뉴' })).toBeVisible();
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeHidden();
});
