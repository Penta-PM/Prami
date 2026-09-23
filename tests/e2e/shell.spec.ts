import { expect, test } from '@playwright/test';

/** QA-00 / AC-00: 셸 렌더, 사이드바 접기/펼치기, 디자인 토큰 CSS 변수 값 */

test('홈이 디자인 셸(사이드바·헤더)로 렌더된다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Prami/);
  await expect(page.getByRole('complementary', { name: '주 메뉴' })).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '통합 검색' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'HOME' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'HOME' })).toBeVisible();
  // 디자인의 "보기 권한" 역할 토글은 제거됨
  await expect(page.getByText('보기 권한')).toHaveCount(0);
});

test('사이드바를 접고 펼칠 수 있다', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: '주 메뉴' });
  const toggle = page.getByRole('button', { name: '사이드바 접기/펼치기' });
  const label = sidebar.getByText('가격 정책 조회');

  await expect(label).toBeVisible();
  const expandedWidth = (await sidebar.boundingBox())?.width ?? 0;
  expect(expandedWidth).toBe(250);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(label).toHaveCount(0);
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(72);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(label).toBeVisible();
});

test('디자인 토큰 CSS 변수가 원본 값으로 정의된다', async ({ page }) => {
  await page.goto('/');
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return {
      lime500: read('--lime-500'),
      lime400: read('--lime-400'),
      ink900: read('--ink-900'),
      fontBody: read('--font-body'),
      textPrimary: read('--text-primary'),
      textH2: read('--text-h2'),
      radiusLg: read('--radius-lg'),
      sidebarWidth: read('--sidebar-width'),
      hairlineSubtle: read('--hairline-subtle'),
      shadowElevated: read('--shadow-elevated'),
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  // 브라우저는 커스텀 속성의 계산값에서 var() 를 치환해 돌려준다 → 참조 대상 토큰의 원본 값과 비교한다
  const compact = (value: string) => value.replace(/\s+/g, '').replace(/"/g, "'");
  expect(tokens.lime500).toBe('#97f675');
  expect(tokens.lime400).toBe('#c8ee44');
  expect(tokens.ink900).toBe('#1b212d');
  expect(compact(tokens.fontBody)).toContain("'Pretendard'");
  expect(tokens.textPrimary).toBe('#1b212d'); // var(--ink-900)
  expect(compact(tokens.textH2)).toMatch(/^60018px\/1'Pretendard',/); // 600 18px/1 var(--font-body)
  expect(tokens.radiusLg).toBe('8px');
  expect(tokens.sidebarWidth).toBe('250px');
  expect(compact(tokens.hairlineSubtle)).toBe('inset0001px#f5f5f5'); // var(--border-subtle) = gray-100
  // var(--shadow-soft) = rgba(0,0,0,0.1). 빌드 시 CSS 최소화가 동일 색을 #0000001a 로 직렬화할 수 있다
  expect(compact(tokens.shadowElevated)).toMatch(/^012px24px(rgba\(0,0,0,0\.1\)|#0000001a)$/);
  expect(tokens.bodyFont).toContain('Pretendard');
});

test('메뉴로 자리표시자 페이지에 이동한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '가격 정책 조회' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { level: 1, name: '가격 정책 조회' })).toBeVisible();
  await expect(page.getByRole('link', { name: '가격 정책 조회' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('link', { name: '감사 로그' }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByRole('heading', { level: 1, name: '감사 로그' })).toBeVisible();
});
