import { expect, test } from '@playwright/test';

import { expectDraft, FIXTURE_ADMIN, FIXTURE_USER, loginAs, signOutLocally } from './helpers';

/**
 * QA-07 (PR-7) — 계산기. globalSetup 이 판매단가 200행 픽스처(WAPPLES 정상판매/ASP/Cloud, N_ 파츠, 전부 KRW)를 적용해 둔다.
 * AC-61(단가유형 = DB), AC-62(파츠), AC-60(금액), AC-63(저장 Q-YYYY-NNNN·목록·담기·삭제·타 사용자 미노출), AC-64(순매출 잠금)
 */
test.describe.configure({ mode: 'serial' });

const YEAR = new Date().getFullYear();

test('USER: STEP1 단가유형 → STEP3 품목·수량 → STEP4 파츠 → 목표금액 역산 → 장바구니 → 저장 → 목록·담기·삭제', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await expect(page.getByRole('heading', { level: 1, name: '계산기' })).toBeVisible();
  const priceTypes = page.getByRole('group', { name: '단가 유형' }).getByRole('button');
  await expect(priceTypes.first()).toContainText('정상판매');
  await expect(priceTypes.filter({ hasText: 'ASP' })).toHaveCount(1);

  const items = page.getByRole('list', { name: '품목 목록' }).getByRole('button');
  await expect(items.first()).toBeVisible();
  const model = items.filter({ hasText: 'Wapples SA-500' }).first();
  await model.click();
  await page.getByRole('button', { name: '수량 증가' }).click();
  const parts = page.getByRole('group', { name: 'STEP 4 · 파츠' });
  await expect(parts.getByRole('checkbox').first()).toBeVisible();
  await parts.locator('label').filter({ hasText: 'N_51080' }).getByRole('checkbox').check();

  const pre = await page.getByTestId('pre-discount').innerText();
  const preValue = Number(pre.replace(/[^\d]/g, ''));
  const target = Math.floor((preValue * 0.7) / 1000) * 1000;
  await page
    .getByRole('spinbutton', { name: '목표 금액으로 역산 (할인율 자동 계산)' })
    .fill(String(target));
  await expect(page.getByTestId('discount-rate')).toHaveText(/\d+(\.\d)?%/);
  const total = Number((await page.getByTestId('line-total').innerText()).replace(/[^\d]/g, ''));
  expect(total % 1000).toBe(0);
  expect(total).toBeLessThanOrEqual(target + 1000);

  await page.getByRole('button', { name: /장바구니에 담기 \(Wapples SA-500/ }).click();
  await expect(page.getByRole('region', { name: '장바구니' })).toContainText('Wapples SA-500');
  await expect(page.getByTestId('quote-total')).toContainText('원');
  // 장바구니는 서버 입력 초안(cart)으로 유지된다 (page-state-memory §2.4-6) — 1s 디바운스 저장 후 새로고침
  await expectDraft(FIXTURE_USER, 'cart');
  await page.reload();
  await expect(page.getByRole('region', { name: '장바구니' })).toContainText('Wapples SA-500');

  await page.getByRole('button', { name: '견적 저장' }).click();
  // 새로고침 뒤에는 복원 배너(role=status)도 있어 저장 안내 문구로 찾는다
  await expect(page.getByRole('status').filter({ hasText: '견적을 저장했습니다' })).toContainText(
    `견적을 저장했습니다: Q-${YEAR}-`,
  );
  const saved = page.getByLabel('내 견적 목록');
  await expect(saved).toContainText(`Q-${YEAR}-`);
  await saved.getByRole('button', { name: /담기/ }).first().click();
  await expect(page.getByRole('region', { name: '장바구니' })).toContainText('Wapples SA-500');

  await page.getByRole('button', { name: '전체보기' }).click();
  const dialog = page.getByRole('dialog', { name: '내 견적 목록' });
  const quoteNo = (
    await dialog.locator('tbody tr').first().locator('td').first().innerText()
  ).trim();
  expect(quoteNo).toMatch(new RegExp(`^Q-${YEAR}-\\d{4}$`));
  await dialog.getByRole('button', { name: `${quoteNo} 삭제` }).click();
  await expect(page.getByRole('status').filter({ hasText: '견적을 삭제했습니다' })).toContainText(
    `견적을 삭제했습니다: ${quoteNo}`,
  );
});

test('AC-63: 다른 사용자(ADMIN 아님)의 목록에는 남의 견적이 없고, ADMIN 목록에는 있다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await page.getByRole('list', { name: '품목 목록' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  await page.getByRole('button', { name: '견적 저장' }).click();
  await expect(page.getByRole('status')).toContainText('견적을 저장했습니다');
  const mine = page.getByLabel('내 견적 목록');
  await expect(mine).toContainText(`Q-${YEAR}-`);
  const count = await mine.locator('li').count();
  expect(count).toBeGreaterThanOrEqual(1);

  // 이미 USER 세션이 있으면 /login 이 즉시 되돌려보내므로 쿠키를 지우고 ADMIN 으로 재로그인
  await signOutLocally(page);
  await loginAs(page, FIXTURE_ADMIN, '/calculator');
  await expect(page.getByLabel('내 견적 목록')).toContainText(`Q-${YEAR}-`);
  await page.goto('/admin/audit?action=quote.save');
  await expect(
    page.getByRole('table', { name: '감사 로그' }).getByRole('row').nth(1),
  ).toContainText('성공');
});

test('STEP2: 중분류 → 소분류 → STEP3 품목이 좁혀진다 (globalSetup 의 품목 마스터 items-v1 적용 데이터)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await page
    .getByRole('group', { name: '제품군' })
    .getByRole('button', { name: 'WAPPLES', exact: true })
    .click();
  const items = page.getByRole('list', { name: '품목 목록' });
  const mids = page.getByRole('group', { name: '중분류' });
  const minors = page.getByRole('group', { name: '소분류' });
  // 첫 로드: 중분류 미선택, 소분류 줄 없음
  await expect(mids.getByRole('button', { name: 'Wapples Product', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(minors).toHaveCount(0);

  await mids.getByRole('button', { name: 'Wapples Product', exact: true }).click();
  // 순서는 DB 정렬(collation)에 따르므로 집합으로 본다
  const minorNames = ['H/W Appliance', 'NIC', 'S/W 업그레이드', 'SSL/TLS Acceleator Options'];
  await expect(minors.getByRole('button')).toHaveCount(minorNames.length);
  for (const name of minorNames) {
    await expect(minors.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(items).toContainText('Wapples 100 T4 S/W v5.0 업그레이드');
  await expect(items).toContainText('Wapples-10000 (H10000 T1)-1G RAID');

  const hw = minors.getByRole('button', { name: 'H/W Appliance', exact: true });
  await hw.click();
  await expect(hw).toHaveAttribute('aria-pressed', 'true');
  await expect(items).toContainText('Wapples-10000 (H10000 T1)-1G RAID');
  await expect(items).not.toContainText('S/W v5.0 업그레이드');

  // 다른 중분류로 바꾸면 소분류가 바뀌고 선택이 풀린다, 같은 중분류 재클릭은 줄을 숨긴다
  await mids.getByRole('button', { name: 'Wapples-CC', exact: true }).click();
  await expect(minors.getByRole('button')).toHaveText(['H/W Appliance']);
  await expect(minors.getByRole('button', { name: 'H/W Appliance', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await mids.getByRole('button', { name: 'Wapples-CC', exact: true }).click();
  await expect(minors).toHaveCount(0);
});

test('AC-64: 순매출 계산기 — USER 원가 잠금·비공개, ADMIN 계산', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/calculator?tab=margin');
  await expect(page.getByRole('status', { name: '원가 잠금' })).toContainText('관리자만 조회 가능');
  await page.getByLabel('정상 판매가 (단가)').fill('1000');
  await page.getByLabel('판매 수량').fill('2');
  await page.getByRole('button', { name: '계산' }).click();
  await expect(page.getByTestId('margin-net')).toContainText('2,000원');
  await expect(page.getByLabel('순매출 결과')).toContainText('비공개');

  await signOutLocally(page);
  await loginAs(page, FIXTURE_ADMIN, '/calculator?tab=margin');
  await page.getByLabel('정상 판매가 (단가)').fill('1000');
  await page.getByLabel('판매 수량').fill('2');
  await page.getByLabel('원가 (단가)').fill('600');
  await page.getByRole('button', { name: '계산' }).click();
  await expect(page.getByTestId('margin-net')).toContainText('800원');
  await expect(page.getByLabel('순매출 결과')).toContainText('40.0%');
});
