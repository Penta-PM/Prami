import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import {
  expectDraft,
  expectNoHydrationErrors,
  FIXTURE_ADMIN,
  FIXTURE_USER,
  loginAs,
  savedDraft,
  signOutLocally,
} from './helpers';

/**
 * 페이지 상태 기억 B-2 — 입력 초안 (docs/specs/page-state-memory.md §2.4·§2.5·§2.6·§4).
 * 견적 계산기·장바구니·순매출(원가 제외) 입력이 재로그인 후 복원 + 복원 배너 + [새로 시작], 가격이 바뀐 장바구니 → 최신가 갱신 배너,
 * 판매 중지 품목 제외 안내, 사용자 B 는 A 의 초안을 못 봄(같은 브라우저), 사용자 설정 전역 초기화, 예전 sessionStorage 키 삭제.
 * 저장은 1s 디바운스 서버 액션이라 DB 행을 폴링해 저장 완료를 기다린다.
 */
test.describe.configure({ mode: 'serial' });

async function query(text: string, values: unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

const cart = (page: Page) => page.getByLabel('장바구니', { exact: true });
const quoteBanner = (page: Page) => page.getByRole('status', { name: '견적 입력 복원 안내' });
const cartBanner = (page: Page) => page.getByRole('status', { name: '장바구니 복원 안내' });

async function relogin(page: Page, email: string, path: string) {
  await signOutLocally(page);
  await loginAs(page, email, path, { keepViewState: true });
}

/** 단가유형 ASP → 첫 품목 선택·수량 2 → 장바구니 담기. 담은 품목명을 돌려준다 */
async function fillQuote(page: Page): Promise<string> {
  await page.getByRole('group', { name: '단가 유형' }).getByRole('button', { name: /ASP/ }).click();
  const first = page.getByRole('list', { name: '품목 목록' }).getByRole('button').first();
  await expect(first).toBeVisible();
  // 버튼 접근 이름 = "품명 (품번)"
  const name = ((await first.getAttribute('aria-label')) ?? '').replace(/ \([^)]*\)$/, '');
  await first.click();
  await page.getByRole('button', { name: '수량 증가' }).click();
  await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  await expect(cart(page)).toContainText(name);
  return name;
}

test('견적 계산기·장바구니: 재로그인 후 복원 + 배너, sessionStorage 장바구니 키는 지워진다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  // 예전 결함: 사용자 구분 없는 sessionStorage 장바구니 — 이전하지 않고 지운다(§2.4-6)
  await page.evaluate(() =>
    window.sessionStorage.setItem(
      'prami.quote.cart.v1',
      JSON.stringify({ lines: [{ id: 'x', name: '남의 장바구니 품목' }] }),
    ),
  );
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('prami.quote.cart.v1')))
    .toBeNull();
  await expect(cart(page)).not.toContainText('남의 장바구니 품목');

  const name = await fillQuote(page);
  await expectDraft(FIXTURE_USER, 'cart');
  await expectDraft(FIXTURE_USER, 'quote', (data) => (data as { qty?: number } | null)?.qty === 2);

  await relogin(page, FIXTURE_USER, '/calculator');
  await expect(quoteBanner(page)).toContainText(
    /이전 작업을 복원했습니다 \(\d{2}-\d{2} \d{2}:\d{2}\) · 새로 시작/,
  );
  await expect(cartBanner(page)).toBeVisible();
  await expect(cart(page)).toContainText(name);
  await expect(
    page.getByRole('group', { name: '단가 유형' }).getByRole('button', { name: /ASP/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: new RegExp(`장바구니에 담기 \\(.* × 2\\)`) }),
  ).toBeEnabled();
  expectNoHydrationErrors(page);

  // [새로 시작] (견적 입력) → 초안 삭제 + 기본 상태, 재진입해도 되살아나지 않음
  await quoteBanner(page).getByRole('button', { name: '새로 시작' }).click();
  await expect(quoteBanner(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /품목을 선택하세요/ })).toBeDisabled();
  await expect.poll(() => savedDraft(FIXTURE_USER, 'quote')).toBeNull();
  // '견적 초기화' → cart 초안 삭제
  await page.getByRole('button', { name: '견적 초기화' }).click();
  await expect.poll(() => savedDraft(FIXTURE_USER, 'cart')).toBeNull();
  await page.reload();
  await expect(quoteBanner(page)).toHaveCount(0);
  await expect(cartBanner(page)).toHaveCount(0);
  await expect(cart(page)).toContainText('담긴 품목이 없습니다');
});

test('가격이 바뀐 장바구니 → 최신가 갱신 + "N건 최신가로 갱신" 배너, 판매 중지 품목은 제외 안내', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  await fillQuote(page);
  await expectDraft(FIXTURE_USER, 'cart');
  const before = await page.getByTestId('quote-total').innerText();
  // 저장 당시 단가를 1원으로 바꾸고(= 그 뒤 가격 변동) 판매하지 않는 품목 라인을 하나 더한다
  await query(
    `update user_drafts d set data = jsonb_build_object('lines',
       jsonb_build_array(
         jsonb_set(d.data->'lines'->0, '{unitPrice}', '1'::jsonb),
         jsonb_set(jsonb_set(d.data->'lines'->0, '{itemCode}', '"NOPE-E2E-1"'::jsonb), '{name}', '"단종 품목"'::jsonb)))
     from users u where u.id = d.user_id and u.email = $1 and d.draft_key = 'cart'`,
    [FIXTURE_USER],
  );
  await page.reload();
  await expect(cartBanner(page)).toContainText('가격이 바뀐 품목 1건을 최신가로 갱신했습니다');
  await expect(cartBanner(page)).toContainText('1건은 더 이상 판매하지 않아 제외했습니다');
  await expect(cart(page)).not.toContainText('단종 품목');
  await expect(page.getByTestId('quote-total')).toHaveText(before);
  // 갱신된 값으로 다시 저장된다
  await expectDraft(
    FIXTURE_USER,
    'cart',
    (data) => ((data as { lines?: unknown[] } | null)?.lines ?? []).length === 1,
  );
  // 장바구니 [새로 시작] = cart 초안 삭제
  await cartBanner(page).getByRole('button', { name: '새로 시작' }).click();
  await expect.poll(() => savedDraft(FIXTURE_USER, 'cart')).toBeNull();
});

test('순매출(원가 제외)·사용자 B 격리: ADMIN 원가 입력은 DB 초안에 없고, 같은 브라우저 B 로그인에 A 초안 없음', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/calculator?tab=margin');
  await page.getByRole('textbox', { name: '정상 판매가 (단가)' }).fill('1200000');
  await page.getByRole('textbox', { name: '원가 (단가)' }).fill('987654');
  await page.getByRole('textbox', { name: '기타 비용' }).fill('4321');
  await expectDraft(
    FIXTURE_ADMIN,
    'margin',
    (data) => (data as { sellingPrice?: string } | null)?.sellingPrice === '1200000',
  );
  const stored = JSON.stringify(await savedDraft(FIXTURE_ADMIN, 'margin'));
  expect(stored).not.toMatch(/unitCost|miscCost|987654|4321/);

  await relogin(page, FIXTURE_ADMIN, '/calculator?tab=margin');
  await expect(page.getByRole('status', { name: '순매출 입력 복원 안내' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '정상 판매가 (단가)' })).toHaveValue('1200000');
  await expect(page.getByRole('textbox', { name: '원가 (단가)' })).toHaveValue('');

  // 같은 브라우저·같은 탭에서 사용자 B
  await relogin(page, FIXTURE_USER, '/calculator?tab=margin');
  await expect(page.getByRole('status', { name: '순매출 입력 복원 안내' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '정상 판매가 (단가)' })).toHaveValue('');
});

test('사용자 설정 전역 초기화: 확인 모달 후 조회 상태·초안 삭제, 표 열 레이아웃(localStorage)은 유지', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator?tab=margin');
  await page.getByRole('textbox', { name: '정상 판매가 (단가)' }).fill('5000');
  await expectDraft(FIXTURE_USER, 'margin');
  await page.evaluate(() => window.localStorage.setItem('prami.e2e.layout-canary', 'keep'));

  await page.goto('/settings');
  await expect(
    page
      .getByText(
        "조회 조건과 작성 중 입력을 지웁니다. 표 열 너비·순서는 각 표의 '열 초기화'로 되돌립니다",
      )
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '저장된 화면·입력 초기화' }).click();
  const dialog = page.getByRole('dialog', { name: '저장된 화면·입력 초기화' });
  await dialog.getByRole('button', { name: '초기화' }).click();
  await expect(page.getByRole('status').filter({ hasText: '초기화했습니다' })).toBeVisible();
  await expect.poll(() => savedDraft(FIXTURE_USER, 'margin')).toBeNull();

  await page.goto('/calculator');
  // 저장된 탭(조회 상태)도 지워져 기본 탭, 초안 배너 없음
  await expect(page).toHaveURL('/calculator');
  await expect(page.getByRole('radio', { name: '견적 계산기' })).toBeChecked();
  await expect(page.getByRole('status', { name: /복원 안내/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('prami.e2e.layout-canary'))).toBe(
    'keep',
  );
});
