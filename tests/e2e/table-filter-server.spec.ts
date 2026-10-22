import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { expectNoHydrationErrors, FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * 표 열 필터 서버 3표 — 빠른 필터 바 (docs/specs/table-column-filter.md §2.3·§2.4·§2.5·§4, table-filter-quickbar §2, PR-3).
 * 가격 관리: 고정 필드 버튼(단가 유형·판매가·상태) + "＋ N개 더", enum 체크 즉시 적용(400ms 디바운스, 이동 1회),
 *   2개 조건 AND → URL f.*·총건수·필드 버튼 값·헤더 점, 필터 변경은 replace(뒤로 가기 기록 없음),
 *   디바운스 중 정렬 → 조건과 정렬이 함께(§6 #7), '필터 초기화' 가 기존 검색 q·정렬까지 해제.
 * 감사: 옛 GET 폼 없음, 옛 ?action=X → 행위 버튼 값, 행위 다중 선택 → action=a,b, CSV 링크에 같은 필터.
 * 원가: 제품군 탭(같은 카드) + 조건 하나 → URL·결과, 초기화는 탭 유지.
 */

/** 빠른 필터 바 (페이지 필터가 있으면 카드 안의 바 줄) */
const quickBar = (page: Page) => page.locator('[data-quick-filter-bar]');
/** 조건이 걸린 필드 버튼 */
const activeFields = (page: Page) =>
  quickBar(page).locator('[data-quick-field][aria-label$="적용 중"]');

/** 그 열의 편집 팝오버 — 바에 버튼이 있으면 그 버튼, 없으면 "＋ N개 더" → 열 */
async function openField(page: Page, column: string): Promise<Locator> {
  const button = quickBar(page).getByRole('button', { name: new RegExp(`^${column} 필터(, |$)`) });
  if ((await button.count()) > 0) await button.click();
  else {
    await quickBar(page)
      .getByRole('button', { name: /^＋ \d+개 더$/ })
      .click();
    await page
      .getByRole('dialog', { name: '필터 더 보기' })
      .getByRole('button', { name: column })
      .click();
  }
  const dialog = page.getByRole('dialog', { name: `${column} 필터` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** text·range 열: fill 후 "적용" */
async function applyField(page: Page, column: string, fill: (dialog: Locator) => Promise<void>) {
  const dialog = await openField(page, column);
  await fill(dialog);
  await dialog.getByRole('button', { name: '적용' }).click();
  await expect(dialog).toBeHidden();
}

/** enum 열: 체크(즉시 적용 — 400ms 디바운스) → URL 이 바뀔 때까지 기다린 뒤 Esc */
async function toggleField(
  page: Page,
  column: string,
  check: (dialog: Locator) => Promise<void>,
  url: RegExp,
) {
  const dialog = await openField(page, column);
  await check(dialog);
  await expect(page).toHaveURL(url);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** "총 N건 · p / P 페이지" 의 N */
async function totalCount(page: Page): Promise<number> {
  const text = await page
    .getByRole('navigation', { name: '페이지' })
    .getByText(/^총 [\d,]+건/)
    .innerText();
  return Number(/^총 ([\d,]+)건/.exec(text)?.[1]?.replaceAll(',', '') ?? Number.NaN);
}

test('가격 관리: 상태 + 비고 조건 AND → URL f.*·총건수·버튼 값·점, 필터 변경은 replace, 필터 초기화는 검색 q·정렬까지 해제', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs');
  await page.goto('/admin/policies?q=P&sort=price&dir=desc');
  const table = page.getByRole('table', { name: '가격정책 관리 표' });
  await expect(table).toBeVisible();
  const before = await totalCount(page);
  expect(before).toBeGreaterThan(0);
  // 기존 검색이 걸려 있으므로 열 필터 없이도 '필터 초기화' 가 보인다 (Q1 B)
  await expect(page.getByRole('button', { name: '필터 초기화' })).toBeVisible();

  // 고정 필드 버튼 + "＋ N개 더". 같은 의미의 열(분류·품목명·기간·운영 연도)과 원가 비중은 어디에도 없다
  await expect(quickBar(page).locator('[data-quick-field]')).toHaveText([
    /^단가 유형/,
    /^판매가/,
    /^상태/,
  ]);
  await quickBar(page).getByRole('button', { name: '＋ 4개 더' }).click();
  await expect(page.getByRole('dialog', { name: '필터 더 보기' }).getByRole('button')).toHaveText([
    '통화',
    '가격 변동',
    '품목상태',
    '비고',
  ]);
  await page.keyboard.press('Escape');
  // 페이지 필터(분류·검색)는 바와 같은 카드(필터 그룹) 안
  await expect(
    page.getByRole('group', { name: '필터' }).getByRole('searchbox', { name: '품목명·품번 검색' }),
  ).toBeVisible();
  // 바 오른쪽 건수
  await expect(quickBar(page).locator('[data-quick-filter-count]')).toHaveText(/^총 [\d,]+건$/);

  await toggleField(
    page,
    '상태',
    (dialog) => dialog.getByRole('checkbox', { name: '운영중' }).check(),
    /[?&]q=P&f\.status\.in=%EC%9A%B4%EC%98%81%EC%A4%91&sort=price&dir=desc$/,
  );
  const afterStatus = await totalCount(page);
  expect(afterStatus).toBeLessThanOrEqual(before);

  await applyField(page, '비고', (dialog) => dialog.getByRole('textbox', { name: '값' }).fill('a'));
  await expect(page).toHaveURL(/&f\.status\.in=[^&]+&f\.remark\.has=a&sort=price&dir=desc$/);
  await expect(activeFields(page)).toHaveText([/상태: 운영중/, /비고: "a" 포함/]);
  await expect(quickBar(page).locator('[data-quick-filter-count]')).toHaveText(/· 조건 2개$/);
  const afterBoth = await totalCount(page);
  expect(afterBoth).toBeLessThanOrEqual(afterStatus);
  if (afterBoth === 0) await expect(page.getByText('조건에 맞는 결과가 없습니다')).toBeVisible();
  else
    await expect(table.locator('th[data-filtered="true"]').filter({ hasText: '상태' })).toHaveCount(
      1,
    );

  // 새로고침해도 같은 조건 (하이드레이션 경고 0)
  await page.reload();
  await expect(activeFields(page)).toHaveCount(2);
  expect(await totalCount(page)).toBe(afterBoth);
  expectNoHydrationErrors(page);

  // 필터 변경은 replace — 뒤로 가기는 필터 이전 기록(원가 화면)으로 간다 (§2.3)
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/costs/);
  await page.goForward();
  await expect(page).toHaveURL(/&f\.remark\.has=a&sort=price&dir=desc$/);

  // 필터 초기화 → 열 필터 + 검색 q + 정렬 해제
  await page.getByRole('button', { name: '필터 초기화' }).first().click();
  await expect(page).toHaveURL(/\/admin\/policies$/);
  await expect(page.getByRole('searchbox', { name: '품목명·품번 검색' })).toHaveValue('');
  await expect(activeFields(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '필터 초기화' })).toHaveCount(0);
  expect(await totalCount(page)).toBeGreaterThanOrEqual(before);
});

test('가격 관리: 400ms 안에 체크 2개 → 이동 1회·두 값 모두 URL, 디바운스 중 정렬 → 조건과 정렬이 함께 (R1·§6 #7)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  const table = page.getByRole('table', { name: '가격정책 관리 표' });
  await expect(table).toBeVisible();

  const dialog = await openField(page, '상태');
  await dialog.getByRole('checkbox', { name: '운영중' }).check();
  await dialog.getByRole('checkbox', { name: '미사용' }).check();
  // 팝오버는 열린 채, 두 값 모두 URL 에
  await expect(page).toHaveURL(
    /f\.status\.in=%EC%9A%B4%EC%98%81%EC%A4%91%2C%EB%AF%B8%EC%82%AC%EC%9A%A9$/,
  );
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: '미사용' }).uncheck();
  await page.keyboard.press('Escape');
  // 디바운스(400ms)가 끝나기 전에 정렬 헤더 → 해제한 값과 정렬이 한 URL 에
  await table
    .getByRole('columnheader', { name: /^판매가/ })
    .getByRole('button')
    .click();
  await expect(page).toHaveURL(/\?f\.status\.in=%EC%9A%B4%EC%98%81%EC%A4%91&sort=price&dir=asc$/);
  await expect(activeFields(page)).toHaveText([/상태: 운영중/]);
});

test('감사: 옛 폼 없음, 옛 ?action=X → 행위 버튼 값, 행위 다중 선택 → action=a,b, CSV 링크에 같은 필터', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/audit?action=auth.login');
  await expect(page.getByRole('table', { name: '감사 로그' })).toBeVisible();
  await expect(page.getByRole('form', { name: '감사 로그 필터' })).toHaveCount(0);
  await expect(activeFields(page)).toHaveText([/행위: auth\.login/]);
  await expect(quickBar(page).locator('[data-quick-field]')).toHaveText([
    /^일시/,
    /^사용자/,
    /^행위/,
    /^결과/,
  ]);
  const single = await totalCount(page);

  // 행위 하나 더 (auth.login 이 아닌 첫 선택지)
  await toggleField(
    page,
    '행위',
    (dialog) => dialog.locator('input[type="checkbox"]:not(:checked)').first().check(),
    /[?&]action=[^&]*auth\.login[^&]*%2C|[?&]action=[^&]*%2C[^&]*auth\.login/,
  );
  await expect(activeFields(page)).toHaveText([/행위: .+,.+/]);
  expect(await totalCount(page)).toBeGreaterThanOrEqual(single);

  // 결과 = 성공 (f.result.in)
  await toggleField(
    page,
    '결과',
    (dialog) => dialog.getByRole('checkbox', { name: '성공' }).check(),
    /&f\.result\.in=success(&|$)/,
  );

  const query = new URL(page.url()).search;
  const href = await page.getByRole('link', { name: 'CSV 내보내기' }).getAttribute('href');
  expect(href).toBe(`/api/audit/export.csv${query}`);

  // CSV 가 화면과 같은 건수
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const lines = (await response.text()).replace(/^﻿/, '').trim().split('\r\n');
  expect(lines.length - 1).toBe(await totalCount(page));

  // 필터 초기화 → 별칭 포함 전부 해제
  await page.getByRole('button', { name: '필터 초기화' }).first().click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(activeFields(page)).toHaveCount(0);
});

test('원가: 제품군 탭(같은 카드) + 상태 조건 하나 → URL f.*·버튼 값·결과, 필터 초기화는 탭을 유지 (§7 Q5)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs');
  const table = page.getByRole('table', { name: '원가 표' });
  await expect(table).toBeVisible();

  // 제품군 탭은 바와 같은 카드(필터 그룹) 안
  const tabs = page
    .getByRole('group', { name: '필터' })
    .getByRole('navigation', { name: '제품군' });
  await expect(tabs).toBeVisible();
  // 제품군 탭(전체 다음 첫 탭)으로 이동 — 탭만으로는 필터가 아니므로 '필터 초기화' 없음
  await tabs.getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/\/admin\/costs\?family=[^&]+$/);
  const tabUrl = page.url();
  await expect(page.getByRole('button', { name: '필터 초기화' })).toHaveCount(0);

  await toggleField(
    page,
    '상태',
    (dialog) => dialog.getByRole('checkbox', { name: '미사용' }).check(),
    /\?family=[^&]+&f\.status\.in=%EB%AF%B8%EC%82%AC%EC%9A%A9$/,
  );
  await expect(activeFields(page)).toHaveText([/상태: 미사용/]);
  const statuses = await table.locator('tbody tr td:nth-child(7)').allInnerTexts();
  // 0건이면 빈 상태는 표 밖에 그려진다 (행 없음)
  expect(statuses.every((text) => text.includes('미사용'))).toBe(true);

  await page.getByRole('button', { name: '필터 초기화' }).first().click();
  await expect(page).toHaveURL(tabUrl);
  await expect(activeFields(page)).toHaveCount(0);
});

test('가격 관리: 쉼표가 든 단가 유형 "Standby,DR" 선택 → URL 이스케이프(\\,)·칩 원래 값·SQL 과 같은 건수 (QA #57 CRITICAL, Plan §7)', async ({
  page,
}) => {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  let expected: number;
  try {
    const result = await client.query<{ n: number }>(
      "select count(*)::int as n from sales_prices where deleted_at is null and price_type = 'Standby,DR'",
    );
    expected = result.rows[0]!.n;
  } finally {
    await client.end();
  }
  expect(expected, 'E2E 픽스처(sales-200)에 Standby,DR 행').toBeGreaterThan(0);

  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  // 값 안의 쉼표는 \, 로 이스케이프돼 URL 에 실린다(%5C%2C)
  await toggleField(
    page,
    '단가 유형',
    (dialog) => dialog.getByRole('checkbox', { name: 'Standby,DR', exact: true }).check(),
    /f\.priceType\.in=Standby%5C%2CDR(&|$)/,
  );
  await expect(activeFields(page)).toContainText('Standby,DR');
  expect(await totalCount(page)).toBe(expected);
  const types = await page
    .getByRole('table', { name: '가격정책 관리 표' })
    .locator('tbody tr td:nth-child(1)')
    .allInnerTexts();
  expect(types.length).toBeGreaterThan(0);
  expect(types.every((text) => text.trim() === 'Standby,DR')).toBe(true);
  expectNoHydrationErrors(page);
});

test('가격 관리: 제어 문자 값(f.remark.has=%00abc·q=%00) → 200, 그 조건만 무시(버튼 값 없음·전체 건수) (BL-1, QA #57 백로그)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');
  const table = page.getByRole('table', { name: '가격정책 관리 표' });
  await expect(table).toBeVisible();
  const all = await totalCount(page);
  expect(all).toBeGreaterThan(0);

  for (const query of [
    'f.remark.has=%00abc',
    'q=%00',
    'f.remark.has=%00abc&q=%00&f.remark.eq=a%7F',
  ]) {
    const response = await page.goto(`/admin/policies?${query}`);
    expect(response?.status(), query).toBe(200);
    await expect(table).toBeVisible();
    await expect(activeFields(page)).toHaveCount(0);
    expect(await totalCount(page)).toBe(all);
  }
  // 정상 조건은 그대로 적용된다 (제어 문자 조건만 버림)
  const response = await page.goto('/admin/policies?f.remark.has=%00abc&f.status.in=운영중');
  expect(response?.status()).toBe(200);
  await expect(activeFields(page)).toHaveText([/상태: 운영중/]);
  expectNoHydrationErrors(page);
});
