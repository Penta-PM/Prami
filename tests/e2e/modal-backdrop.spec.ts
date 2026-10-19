import { expect, test, type Locator, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 공용 모달 백드롭 오인 닫힘 (modal-backdrop-press-origin 스펙 §4). 브라우저는 click 을 pointerdown·pointerup 대상의 공통 조상으로
 * 보낸다 — 패널 안에서 눌러 백드롭에서 놓으면(텍스트 선택·DataTable 리사이즈) 대상이 <dialog> 자신이라 예전에는 닫혔다.
 * 실제 마우스(down → move → up)로 재현한다. 진짜 백드롭 클릭·Escape·× 는 닫힌다.
 */
test.describe.configure({ mode: 'serial' });

/** 대화상자 패널(제목이 있는 카드) 밖 — 화면 왼쪽 위 모서리는 항상 백드롭이다 */
const BACKDROP = { x: 8, y: 8 };

async function openNoticeForm(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '+ 공지 등록' }).click();
  const dialog = page.getByRole('dialog', { name: '공지 등록' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('텍스트를 드래그 선택하다 백드롭에서 놓아도 모달이 열린 채이고 입력값이 유지된다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/notices');
  const dialog = await openNoticeForm(page);
  const title = dialog.getByLabel('제목');
  await title.fill('드래그 선택 유지');
  const box = await title.boundingBox();
  if (!box) throw new Error('제목 입력 위치를 알 수 없다');
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(BACKDROP.x, BACKDROP.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(dialog).toBeVisible();
  await expect(title).toHaveValue('드래그 선택 유지');

  // 같은 모달의 진짜 백드롭 클릭(백드롭에서 누르고 놓음)은 닫힌다
  await page.mouse.click(BACKDROP.x, BACKDROP.y);
  await expect(dialog).toBeHidden();
});

test('모달 헤더를 누른 채 백드롭으로 끌어 놓거나 백드롭에서 눌러 안에서 놓아도 닫히지 않고, Escape·× 는 닫는다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/notices');
  let dialog = await openNoticeForm(page);
  const heading = dialog.getByRole('heading', { name: '공지 등록' });
  const box = await heading.boundingBox();
  if (!box) throw new Error('제목 위치를 알 수 없다');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(BACKDROP.x, BACKDROP.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(dialog).toBeVisible();

  // 백드롭에서 누르고 패널 안(제목)에서 놓아도 닫히지 않는다 (Q-M1 = A)
  await page.mouse.move(BACKDROP.x, BACKDROP.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openNoticeForm(page);
  await dialog.getByRole('button', { name: '닫기' }).click();
  await expect(dialog).toBeHidden();
});

test('내 견적 목록 모달에서 열 리사이즈 핸들을 백드롭까지 끌어 놓아도 닫히지 않는다 (#32 회귀)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await page.getByRole('list', { name: '품목 목록' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  await page.getByRole('button', { name: '견적 저장' }).click();
  await expect(page.getByRole('status')).toContainText('견적을 저장했습니다');
  await page.getByRole('button', { name: '전체보기' }).click();
  const dialog = page.getByRole('dialog', { name: '내 견적 목록' });
  await expect(dialog).toBeVisible();

  const handle = dialog.getByRole('separator').first();
  const box = await handle.boundingBox();
  if (!box) throw new Error('리사이즈 핸들 위치를 알 수 없다');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(BACKDROP.x, box.y + box.height / 2, { steps: 8 });
  await page.mouse.move(BACKDROP.x, BACKDROP.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(dialog).toBeVisible();

  // 정리: 방금 저장한 견적 삭제
  const quoteNo = (
    await dialog.locator('tbody tr').first().locator('td').first().innerText()
  ).trim();
  await dialog.getByRole('button', { name: `${quoteNo} 삭제` }).click();
  await expect(page.getByRole('status')).toContainText(`견적을 삭제했습니다: ${quoteNo}`);
});
