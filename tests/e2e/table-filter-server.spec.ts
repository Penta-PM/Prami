import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { expectNoHydrationErrors, FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * 표 열 필터 A-2 서버 3표 (docs/specs/table-column-filter.md §2.3·§2.4·§2.5·§4, Plan Q1 B·Q3 A).
 * 가격 관리: 2개 조건 AND → URL f.*·총건수·칩·헤더 점, '필터 초기화' 가 기존 검색 q·정렬까지 해제.
 * 감사: 옛 GET 폼 없음, 옛 ?action=X → 칩, 행위 다중 선택 → action=a,b, CSV 링크에 같은 필터.
 * 원가: 조건 하나 → URL·칩·결과.
 */

const chipList = (page: Page) => page.getByRole('list', { name: '적용된 필터' });

/** "＋ 필터" → 열 선택 → `<열> 필터` 팝오버. fill 후 "적용" */
async function addFilter(page: Page, column: string, fill: (dialog: Locator) => Promise<void>) {
  await page.getByRole('button', { name: '＋ 필터' }).click();
  const picker = page.getByRole('dialog', { name: '필터할 열 선택' });
  await picker.getByRole('button', { name: new RegExp(`^${column}`) }).click();
  const dialog = page.getByRole('dialog', { name: `${column} 필터` });
  await expect(dialog).toBeVisible();
  await fill(dialog);
  await dialog.getByRole('button', { name: '적용' }).click();
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

test('가격 관리: 상태 + 비고 조건 AND → URL f.*·총건수·칩·점, 필터 초기화는 검색 q·정렬까지 해제', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies?q=P&sort=price&dir=desc');
  const table = page.getByRole('table', { name: '가격정책 관리 표' });
  await expect(table).toBeVisible();
  const before = await totalCount(page);
  expect(before).toBeGreaterThan(0);
  // 기존 검색이 걸려 있으므로 열 필터 없이도 '필터 초기화' 가 보인다 (Q1 B)
  await expect(page.getByRole('button', { name: '필터 초기화' })).toBeVisible();

  // 같은 의미의 열(분류·품목명·기간·운영 연도)과 원가 비중은 열 목록에 없다
  await page.getByRole('button', { name: '＋ 필터' }).click();
  const picker = page.getByRole('dialog', { name: '필터할 열 선택' });
  await expect(picker.getByRole('button')).toHaveText([
    '단가 유형',
    '통화',
    '판매가',
    '가격 변동',
    '품목상태',
    '상태',
    '비고',
  ]);
  await page.keyboard.press('Escape');

  await addFilter(page, '상태', (dialog) =>
    dialog.getByRole('checkbox', { name: '운영중' }).check(),
  );
  await expect(page).toHaveURL(
    /[?&]q=P&f\.status\.in=%EC%9A%B4%EC%98%81%EC%A4%91&sort=price&dir=desc$/,
  );
  const afterStatus = await totalCount(page);
  expect(afterStatus).toBeLessThanOrEqual(before);

  await addFilter(page, '비고', (dialog) => dialog.getByRole('textbox', { name: '값' }).fill('a'));
  await expect(page).toHaveURL(/&f\.status\.in=[^&]+&f\.remark\.has=a&sort=price&dir=desc$/);
  await expect(chipList(page).getByRole('listitem')).toHaveText([/상태: 운영중/, /비고: "a" 포함/]);
  const afterBoth = await totalCount(page);
  expect(afterBoth).toBeLessThanOrEqual(afterStatus);
  if (afterBoth === 0) await expect(page.getByText('조건에 맞는 결과가 없습니다')).toBeVisible();
  else
    await expect(table.locator('th[data-filtered="true"]').filter({ hasText: '상태' })).toHaveCount(
      1,
    );

  // 새로고침해도 같은 조건 (하이드레이션 경고 0)
  await page.reload();
  await expect(chipList(page).getByRole('listitem')).toHaveCount(2);
  expect(await totalCount(page)).toBe(afterBoth);
  expectNoHydrationErrors(page);

  // 필터 초기화 → 열 필터 + 검색 q + 정렬 해제
  await page.getByRole('button', { name: '필터 초기화' }).first().click();
  await expect(page).toHaveURL(/\/admin\/policies$/);
  await expect(page.getByRole('searchbox', { name: '품목명·품번 검색' })).toHaveValue('');
  await expect(chipList(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '필터 초기화' })).toHaveCount(0);
  expect(await totalCount(page)).toBeGreaterThanOrEqual(before);
});

test('감사: 옛 폼 없음, 옛 ?action=X → 칩, 행위 다중 선택 → action=a,b, CSV 링크에 같은 필터', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/audit?action=auth.login');
  await expect(page.getByRole('table', { name: '감사 로그' })).toBeVisible();
  await expect(page.getByRole('form', { name: '감사 로그 필터' })).toHaveCount(0);
  await expect(chipList(page).getByRole('listitem')).toHaveText([/행위: auth\.login/]);
  const single = await totalCount(page);

  // 행위 하나 더 (auth.login 이 아닌 첫 선택지)
  await addFilter(page, '행위', (dialog) =>
    dialog.locator('input[type="checkbox"]:not(:checked)').first().check(),
  );
  await expect(page).toHaveURL(
    /[?&]action=[^&]*auth\.login[^&]*%2C|[?&]action=[^&]*%2C[^&]*auth\.login/,
  );
  await expect(chipList(page).getByRole('listitem')).toHaveText([/행위: .+, .+/]);
  expect(await totalCount(page)).toBeGreaterThanOrEqual(single);

  // 결과 = 성공 (f.result.in)
  await addFilter(page, '결과', (dialog) => dialog.getByRole('checkbox', { name: '성공' }).check());
  await expect(page).toHaveURL(/&f\.result\.in=success(&|$)/);

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
  await expect(chipList(page)).toHaveCount(0);
});

test('원가: 제품군 탭 + 상태 조건 하나 → URL f.*·칩·결과, 필터 초기화는 탭을 유지 (§7 Q5)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/costs');
  const table = page.getByRole('table', { name: '원가 표' });
  await expect(table).toBeVisible();

  // 제품군 탭(전체 다음 첫 탭)으로 이동 — 탭만으로는 필터가 아니므로 '필터 초기화' 없음
  await page.getByRole('navigation', { name: '제품군' }).getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/\/admin\/costs\?family=[^&]+$/);
  const tabUrl = page.url();
  await expect(page.getByRole('button', { name: '필터 초기화' })).toHaveCount(0);

  await addFilter(page, '상태', (dialog) =>
    dialog.getByRole('checkbox', { name: '미사용' }).check(),
  );
  await expect(page).toHaveURL(/\?family=[^&]+&f\.status\.in=%EB%AF%B8%EC%82%AC%EC%9A%A9$/);
  await expect(chipList(page).getByRole('listitem')).toHaveText([/상태: 미사용/]);
  const statuses = await table.locator('tbody tr td:nth-child(7)').allInnerTexts();
  // 0건이면 빈 상태는 표 밖에 그려진다 (행 없음)
  expect(statuses.every((text) => text.includes('미사용'))).toBe(true);

  await page.getByRole('button', { name: '필터 초기화' }).first().click();
  await expect(page).toHaveURL(tabUrl);
  await expect(chipList(page)).toHaveCount(0);
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
  await addFilter(page, '단가 유형', async (dialog) => {
    await dialog.getByRole('checkbox', { name: 'Standby,DR', exact: true }).check();
  });
  // 값 안의 쉼표는 \, 로 이스케이프돼 URL 에 실린다(%5C%2C)
  await expect(page).toHaveURL(/f\.priceType\.in=Standby%5C%2CDR(&|$)/);
  await expect(chipList(page)).toContainText('Standby,DR');
  expect(await totalCount(page)).toBe(expected);
  const types = await page
    .getByRole('table', { name: '가격정책 관리 표' })
    .locator('tbody tr td:nth-child(1)')
    .allInnerTexts();
  expect(types.length).toBeGreaterThan(0);
  expect(types.every((text) => text.trim() === 'Standby,DR')).toBe(true);
  expectNoHydrationErrors(page);
});
