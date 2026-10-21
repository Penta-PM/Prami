import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { expectNoHydrationErrors, FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 표 열 필터 A-1 (docs/specs/table-column-filter.md §2.5·§4) — 사용자 표 파일럿 + 내 견적 목록 모달.
 * 키보드만으로 팝오버 열기·적용, URL f.* 반영(router.replace)·새로고침 유지, 칩 × 해제, 필터 초기화, axe, 모달 안 Esc.
 */

const usersTable = (page: Page) => page.getByRole('table', { name: '사용자 목록' });
const chipList = (page: Page) => page.getByRole('list', { name: '적용된 필터' });

/** "＋ 필터" 에 포커스 → Enter → 열 목록에서 Tab 으로 column 까지 → Enter. 편집 팝오버를 돌려준다 */
async function openColumnByKeyboard(page: Page, column: string) {
  await page.getByRole('button', { name: '＋ 필터' }).focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: '필터할 열 선택' });
  await expect(picker).toBeVisible();
  // 열리면 첫 열 버튼에 포커스 — 대상 열까지 Tab
  for (let i = 0; i < 10; i += 1) {
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    if (focused.startsWith(column)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `${column} 필터` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('사용자 표: 키보드로 2개 조건 적용 → URL f.*·칩·건수, 새로고침 유지, × 해제, 필터 초기화', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  await expect(usersTable(page)).toContainText(FIXTURE_USER);

  // 1) 역할 = ADMIN (체크박스에 첫 포커스 → Space → Enter)
  let dialog = await openColumnByKeyboard(page, '역할');
  await expect(dialog.getByRole('checkbox', { name: 'ADMIN' })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '＋ 필터' })).toBeFocused();
  await expect(page).toHaveURL(/[?&]f\.role\.in=ADMIN(&|$)/);

  // 2) 이메일 포함 "fixture-admin" (연산자 select 에 첫 포커스 → Tab → 값 → Enter)
  dialog = await openColumnByKeyboard(page, '이메일');
  await expect(dialog.getByRole('combobox', { name: '조건' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.type('fixture-admin');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/[?&]f\.email\.has=fixture-admin(&|$)/);

  await expect(chipList(page).getByRole('listitem')).toHaveText([
    /이메일: "fixture-admin" 포함/,
    /역할: ADMIN/,
  ]);
  await expect(usersTable(page)).toContainText(FIXTURE_ADMIN);
  await expect(usersTable(page)).not.toContainText(FIXTURE_USER);
  await expect(page.getByText(/^전체 \d+건 중 1건$/)).toBeVisible();
  await expect(
    usersTable(page).locator('th[data-filtered="true"]').filter({ hasText: '역할' }),
  ).toHaveCount(1);

  // 3) 새로고침해도 URL 의 조건이 그대로 (하이드레이션 경고 0)
  await page.reload();
  await expect(chipList(page).getByRole('listitem')).toHaveCount(2);
  await expect(usersTable(page)).not.toContainText(FIXTURE_USER);
  expectNoHydrationErrors(page);

  // 4) 칩 × → 그 열만 해제
  await page.getByRole('button', { name: '역할 필터 해제' }).click();
  await expect(page).not.toHaveURL(/f\.role\.in=/);
  await expect(page).toHaveURL(/f\.email\.has=fixture-admin/);
  await expect(chipList(page).getByRole('listitem')).toHaveCount(1);

  // 5) 필터 초기화 → f.* 모두 제거, 전체 목록
  await page.getByRole('button', { name: '필터 초기화' }).click();
  await expect(page).not.toHaveURL(/[?&]f\./);
  await expect(chipList(page)).toHaveCount(0);
  await expect(usersTable(page)).toContainText(FIXTURE_USER);
});

test('사용자 표: 열린 필터 팝오버 axe 위반 0, Esc 는 팝오버만 닫고 트리거로 포커스', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const dialog = await openColumnByKeyboard(page, '이름');
  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"][aria-label="이름 필터"]')
    .analyze();
  expect(
    axe.violations,
    JSON.stringify(axe.violations.map((v) => [v.id, v.nodes.map((n) => n.html)])),
  ).toEqual([]);
  expect(axe.passes.flatMap((rule) => rule.nodes).length, 'axe 가 검사한 요소').toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '＋ 필터' })).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]f\./);
});

test('사용자 표: 비활성 필터 결과의 상태 필 색 대비 axe 위반 0 (A-1 QA 백로그 — 비활성 필 red-600)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users?f.status.in=inactive');
  await expect(chipList(page).getByRole('listitem')).toHaveText([/상태: 비활성/]);
  const pills = usersTable(page).locator('tbody').getByText('비활성', { exact: true });
  // 비활성 사용자는 auth.spec(사전 등록 → 비활성화)이 만든다 — 이 파일만 따로 돌려 0건이면 검사 대상이 없다
  test.skip((await pills.count()) === 0, '비활성 사용자 없음 (auth.spec 이후 실행 시 검사)');
  const axe = await new AxeBuilder({ page })
    .include('table[aria-label="사용자 목록"]')
    .withRules(['color-contrast'])
    .analyze();
  expect(
    axe.violations,
    JSON.stringify(axe.violations.map((v) => [v.id, v.nodes.map((n) => n.html)])),
  ).toEqual([]);
});

test('사용자 표: 팝오버가 열린 채 비활성 버튼(열 초기화)을 눌러도 닫히고, Esc 도 동작 (A-1 QA 백로그)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const reset = page.getByRole('button', { name: '열 초기화' });
  await expect(reset).toBeDisabled();
  await page.getByRole('button', { name: '＋ 필터' }).click();
  const picker = page.getByRole('dialog', { name: '필터할 열 선택' });
  await expect(picker).toBeVisible();
  // 비활성 버튼은 click 이 오지 않는다 — 좌표로 누른다 (Playwright click 은 활성화를 기다림)
  const box = await reset.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(picker).toBeHidden();
  await expect(page.getByRole('button', { name: '＋ 필터' })).toBeFocused();
});

test('내 견적 목록 모달: 필터는 URL 이 아닌 상태, 모달 안 Esc → 팝오버만 닫히고 모달 유지', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await page.getByRole('list', { name: '품목 목록' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  await page.getByRole('button', { name: '견적 저장' }).click();
  await expect(page.getByRole('status')).toContainText('견적을 저장했습니다');
  await page.getByRole('button', { name: '전체보기' }).click();
  const modal = page.getByRole('dialog', { name: '내 견적 목록' });
  await expect(modal).toBeVisible();
  await expect(modal.getByText('최근 100건 안에서 필터합니다')).toBeVisible();
  const quoteNo = (
    await modal.locator('tbody tr').first().locator('td').first().innerText()
  ).trim();
  const urlBefore = page.url();

  // 견적 번호 같음 → 1건, URL 변화 없음
  await modal.getByRole('button', { name: '＋ 필터' }).click();
  await page
    .getByRole('dialog', { name: '필터할 열 선택' })
    .getByRole('button', { name: '견적 번호' })
    .click();
  let filter = page.getByRole('dialog', { name: '견적 번호 필터' });
  await filter.getByRole('combobox', { name: '조건' }).selectOption('eq');
  await filter.getByRole('textbox', { name: '값' }).fill(quoteNo);
  await filter.getByRole('textbox', { name: '값' }).press('Enter');
  await expect(filter).toBeHidden();
  await expect(modal.locator('tbody tr')).toHaveCount(1);
  expect(page.url()).toBe(urlBefore);

  // 팝오버를 다시 열고 Esc — 팝오버만 닫힌다
  await modal.getByRole('button', { name: '＋ 필터' }).click();
  await page
    .getByRole('dialog', { name: '필터할 열 선택' })
    .getByRole('button', { name: /^견적 번호/ })
    .click();
  filter = page.getByRole('dialog', { name: '견적 번호 필터' });
  await expect(filter.getByRole('combobox', { name: '조건' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(filter).toBeHidden();
  await page.waitForTimeout(300);
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: '＋ 필터' })).toBeFocused();

  // 정리: 필터 초기화 후 방금 저장한 견적 삭제
  await modal.getByRole('button', { name: '필터 초기화' }).first().click();
  await modal.getByRole('button', { name: `${quoteNo} 삭제` }).click();
  await expect(page.getByRole('status')).toContainText(`견적을 삭제했습니다: ${quoteNo}`);
});

test('사용자 표 320px: 결과 없음 빈 상태 문구·[필터 초기화]가 보이는 영역 안, 클릭하면 해제 (§2.5-7, A-1 백로그)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await loginAs(page, FIXTURE_ADMIN, '/admin/users?f.email.has=zzz-bl1-no-match');
  await expect(chipList(page).getByRole('listitem')).toHaveText([
    /이메일: "zzz-bl1-no-match" 포함/,
  ]);
  const message = usersTable(page).getByText('조건에 맞는 결과가 없습니다');
  const reset = usersTable(page).getByRole('button', { name: '필터 초기화' });
  await expect(message).toBeInViewport({ ratio: 1 });
  await expect(reset).toBeInViewport({ ratio: 1 });
  // 표 가로 스크롤 영역 안에서도 잘리지 않는다 (스크롤 영역의 보이는 폭 안)
  const scroller = usersTable(page).locator('xpath=..');
  const area = (await scroller.boundingBox())!;
  for (const target of [message, reset]) {
    const box = (await target.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(area.x);
    expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
  }
  await reset.click();
  await expect(page).not.toHaveURL(/f\.email/);
  await expect(usersTable(page)).toContainText(FIXTURE_USER);
  expectNoHydrationErrors(page);
});

test('사용자 표(클라이언트): 제어 문자 필터 값(f.email.has=%00abc) → 그 조건만 무시, 칩 없음 (BL-1)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const response = await page.goto('/admin/users?f.email.has=%00abc&f.role.in=ADMIN');
  expect(response?.status()).toBe(200);
  await expect(chipList(page).getByRole('listitem')).toHaveText([/역할: ADMIN/]);
  await expect(usersTable(page)).not.toContainText('조건에 맞는 결과가 없습니다');
  expectNoHydrationErrors(page);
});
