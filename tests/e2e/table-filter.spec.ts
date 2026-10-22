import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectNoHydrationErrors, FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 표 열 필터 A-1 (docs/specs/table-column-filter.md §2.5·§4) + 빠른 필터 바 PR-2 (table-filter-quickbar §2) —
 * 사용자 표 + 내 견적 목록 모달(금액 슬라이더 §7.5 포함). 고정 필드 버튼 → 편집기 바로(열 선택 단계 없음), 고정 아닌 필드는 "＋ N개 더",
 * enum 체크 즉시 적용, 키보드만으로 열기·적용, URL f.* 반영(router.replace)·새로고침 유지, 필드 버튼 × 해제,
 * 필터 초기화, axe, 모달 안 Esc. 별도 '적용된 필터' 칩 줄은 없다(필드 버튼이 곧 칩).
 */

const usersTable = (page: Page) => page.getByRole('table', { name: '사용자 목록' });
/** 조건이 걸린 필드 버튼 (`{열}: {값}`) — 옛 '적용된 필터' 칩 줄 대신 */
const activeFields = (scope: Page | Locator) =>
  scope.locator('[data-quick-field][aria-label$=" 적용 중"]');
/** 바의 필드 버튼 — 비활성 "{열} 필터", 활성 "{열} 필터, {값} 적용 중" ('{열} 필터 해제' × 와 구분) */
const fieldButton = (scope: Page | Locator, column: string) =>
  scope.getByRole('button', { name: new RegExp(`^${column} 필터(, .+ 적용 중)?$`) });

/**
 * 키보드로 필드 편집 팝오버를 연다: 바에 필드 버튼이 있으면 포커스 → Enter, 없으면 "＋ N개 더" → Enter →
 * 필드 목록에서 Tab 으로 column 까지 → Enter. 편집 팝오버를 돌려준다
 */
async function openFieldByKeyboard(page: Page, column: string) {
  const direct = fieldButton(page, column);
  if ((await direct.count()) > 0) {
    await direct.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('button', { name: /^＋ \d+개 더$/ }).focus();
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog', { name: '필터 더 보기' });
    await expect(picker).toBeVisible();
    // 열리면 첫 필드 버튼에 포커스 — 대상 필드까지 Tab
    for (let i = 0; i < 10; i += 1) {
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
      if (focused.startsWith(column)) break;
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
  }
  const dialog = page.getByRole('dialog', { name: `${column} 필터` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('사용자 표: 고정 필드 버튼·"＋ 2개 더", 키보드로 2개 조건 적용 → URL f.*·필드 버튼·건수, 새로고침 유지, × 해제, 필터 초기화', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  await expect(usersTable(page)).toContainText(FIXTURE_USER);
  // 고정 필드(이름·부서·역할·상태)는 항상 버튼, 나머지(이메일·마지막 로그인)는 "＋ 2개 더". 칩 줄 없음, 건수는 바 오른쪽
  for (const column of ['이름', '부서', '역할', '상태'])
    await expect(fieldButton(page, column)).toBeVisible();
  await expect(fieldButton(page, '이메일')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '＋ 2개 더' })).toBeVisible();
  await expect(page.getByRole('list', { name: '적용된 필터' })).toHaveCount(0);
  await expect(page.getByText(/^\d+건$/)).toBeVisible();

  // 1) 역할 = ADMIN — 버튼 → 체크박스(첫 포커스) Space = 즉시 적용, 팝오버는 열린 채. Esc 로 닫으면 필드 버튼으로 포커스
  let dialog = await openFieldByKeyboard(page, '역할');
  await expect(dialog.getByRole('checkbox', { name: 'ADMIN' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/[?&]f\.role\.in=ADMIN(&|$)/);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(fieldButton(page, '역할')).toBeFocused();

  // 2) 이메일 포함 "fixture-admin" — "＋ 2개 더" → 이메일 → 값(첫 포커스) → Enter
  dialog = await openFieldByKeyboard(page, '이메일');
  await expect(dialog.getByRole('textbox', { name: '값' })).toBeFocused();
  await page.keyboard.type('fixture-admin');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/[?&]f\.email\.has=fixture-admin(&|$)/);
  // 조건이 걸린 고정 아닌 필드는 바에 활성 버튼으로 나타나고 포커스를 받는다
  await expect(fieldButton(page, '이메일')).toBeFocused();
  await expect(page.getByRole('button', { name: '＋ 1개 더' })).toBeVisible();

  await expect(activeFields(page)).toHaveText([/이메일: "fixture-admin" 포함/, /역할: ADMIN/]);
  await expect(usersTable(page)).toContainText(FIXTURE_ADMIN);
  await expect(usersTable(page)).not.toContainText(FIXTURE_USER);
  await expect(page.getByText(/^전체 \d+건 중 1건$/)).toBeVisible();
  await expect(
    usersTable(page).locator('th[data-filtered="true"]').filter({ hasText: '역할' }),
  ).toHaveCount(1);

  // 3) 새로고침해도 URL 의 조건이 그대로 (하이드레이션 경고 0)
  await page.reload();
  await expect(activeFields(page)).toHaveCount(2);
  await expect(usersTable(page)).not.toContainText(FIXTURE_USER);
  expectNoHydrationErrors(page);

  // 4) 필드 버튼 × → 그 열만 해제, 고정 필드라 버튼은 남고 포커스를 받는다
  await page.getByRole('button', { name: '역할 필터 해제' }).click();
  await expect(page).not.toHaveURL(/f\.role\.in=/);
  await expect(page).toHaveURL(/f\.email\.has=fixture-admin/);
  await expect(activeFields(page)).toHaveCount(1);
  await expect(fieldButton(page, '역할')).toHaveAccessibleName('역할 필터');
  await expect(fieldButton(page, '역할')).toBeFocused();

  // 5) 필터 초기화 → f.* 모두 제거, 전체 목록
  await page.getByRole('button', { name: '필터 초기화' }).click();
  await expect(page).not.toHaveURL(/[?&]f\./);
  await expect(activeFields(page)).toHaveCount(0);
  await expect(fieldButton(page, '이메일')).toHaveCount(0);
  await expect(usersTable(page)).toContainText(FIXTURE_USER);
});

test('사용자 표: 열린 필터 팝오버 axe 위반 0, Esc 는 팝오버만 닫고 필드 버튼으로 포커스', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const dialog = await openFieldByKeyboard(page, '이름');
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
  await expect(fieldButton(page, '이름')).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]f\./);
});

test('사용자 표: 비활성 필터 결과의 상태 필 색 대비 axe 위반 0 (A-1 QA 백로그 — 비활성 필 red-600)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users?f.status.in=inactive');
  await expect(activeFields(page)).toHaveText([/상태: 비활성/]);
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
  await fieldButton(page, '이름').click();
  const popover = page.getByRole('dialog', { name: '이름 필터' });
  await expect(popover).toBeVisible();
  // 비활성 버튼은 click 이 오지 않는다 — 좌표로 누른다 (Playwright click 은 활성화를 기다림)
  const box = await reset.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(popover).toBeHidden();
  await expect(fieldButton(page, '이름')).toBeFocused();
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

  // 고정 필드 일자·제품·내용, 나머지(견적 번호·금액·통화)는 "＋ 3개 더"
  for (const column of ['일자', '제품', '내용'])
    await expect(fieldButton(modal, column)).toBeVisible();
  await expect(fieldButton(modal, '견적 번호')).toHaveCount(0);

  // 견적 번호 같음 → 1건, URL 변화 없음
  await modal.getByRole('button', { name: '＋ 3개 더' }).click();
  await page
    .getByRole('dialog', { name: '필터 더 보기' })
    .getByRole('button', { name: '견적 번호' })
    .click();
  let filter = page.getByRole('dialog', { name: '견적 번호 필터' });
  await filter.getByRole('button', { name: '같음', exact: true }).click();
  await filter.getByRole('textbox', { name: '값' }).fill(quoteNo);
  await filter.getByRole('textbox', { name: '값' }).press('Enter');
  await expect(filter).toBeHidden();
  await expect(modal.locator('tbody tr')).toHaveCount(1);
  await expect(activeFields(modal)).toHaveText([new RegExp(`견적 번호: "${quoteNo}" 같음`)]);
  expect(page.url()).toBe(urlBefore);

  // 걸린 조건은 바의 활성 버튼으로 바로 다시 연다 — Esc 는 팝오버만 닫는다
  await fieldButton(modal, '견적 번호').click();
  filter = page.getByRole('dialog', { name: '견적 번호 필터' });
  await expect(filter.getByRole('textbox', { name: '값' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(filter).toBeHidden();
  await page.waitForTimeout(300);
  await expect(modal).toBeVisible();
  await expect(fieldButton(modal, '견적 번호')).toBeFocused();

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
  await expect(activeFields(page)).toHaveText([/이메일: "zzz-bl1-no-match" 포함/]);
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

test('사용자 표(클라이언트): 제어 문자 필터 값(f.email.has=%00abc) → 그 조건만 무시, 활성 버튼 없음 (BL-1)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/users');
  const response = await page.goto('/admin/users?f.email.has=%00abc&f.role.in=ADMIN');
  expect(response?.status()).toBe(200);
  await expect(activeFields(page)).toHaveText([/역할: ADMIN/]);
  await expect(usersTable(page)).not.toContainText('조건에 맞는 결과가 없습니다');
  expectNoHydrationErrors(page);
});

test('내 견적 목록 모달 금액 슬라이더(§7.5): 숫자 입력 없음, 통화 라디오 → 상한 Home(최소 금액) → 그 금액 이하만, URL 변화 없음', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  // 금액이 다른 견적 2건 — 금액이 하나뿐이면 슬라이더 대신 "값이 하나뿐입니다" 가 나온다(§7.5)
  const saved: string[] = [];
  for (const quantityUp of [0, 2]) {
    await page.getByRole('list', { name: '품목 목록' }).getByRole('button').first().click();
    for (let i = 0; i < quantityUp; i += 1) {
      await page.getByRole('button', { name: '수량 증가' }).click();
    }
    await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
    await page.getByRole('button', { name: '견적 저장' }).click();
    const status = page.getByRole('status').filter({ hasText: '견적을 저장했습니다' });
    await expect(status).toContainText(/Q-\d{4}-/);
    saved.push(((await status.innerText()).match(/Q-\d{4}-\d+/) ?? [''])[0]);
    await page.getByRole('button', { name: '견적 초기화' }).click();
  }
  await page.getByRole('button', { name: '전체보기' }).click();
  const modal = page.getByRole('dialog', { name: '내 견적 목록' });
  await expect(modal).toBeVisible();
  const urlBefore = page.url();

  await modal.getByRole('button', { name: /^＋ \d+개 더$/ }).click();
  await page
    .getByRole('dialog', { name: '필터 더 보기' })
    .getByRole('button', { name: '금액' })
    .click();
  const dialog = page.getByRole('dialog', { name: '금액 필터' });
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  // 범위는 지금 목록에서 계산 — 첫 통화를 고르면(즉시 적용) 슬라이더가 켜진다
  await dialog.getByRole('radio').first().check();
  const upper = dialog.getByRole('slider', { name: '금액 최대' });
  await expect(upper).toBeEnabled();
  await expect(upper).toHaveAttribute('aria-valuetext', '제한 없음');
  await upper.focus();
  await page.keyboard.press('Home');
  // 상한 칸 0 = 그 통화의 실제 최소 금액 → 그 금액 이하 행만 (1건 이상)
  await expect(activeFields(modal)).toHaveText([/금액: [A-Z]{3} .+ 이하/, /통화: [A-Z]{3}/]);
  await expect(dialog).toBeVisible();
  expect(await modal.locator('tbody tr').count()).toBeGreaterThan(0);
  expect(page.url()).toBe(urlBefore);

  // 상한을 오른쪽 끝으로 = 금액 조건 없음 (통화만)
  await page.keyboard.press('End');
  await expect(activeFields(modal)).toHaveText([/통화: [A-Z]{3}/]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 정리: 필터 초기화 후 방금 저장한 견적 삭제
  await modal.getByRole('button', { name: '필터 초기화' }).first().click();
  for (const quoteNo of saved) {
    await modal.getByRole('button', { name: `${quoteNo} 삭제` }).click();
    await expect(page.getByRole('status').filter({ hasText: '견적을 삭제했습니다' })).toContainText(
      quoteNo,
    );
  }
});
