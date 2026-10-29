import { expect, test } from '@playwright/test';

import { FIXTURE_ADMIN, loginAs } from './helpers';

/** QA-00 / AC-00: 셸 렌더, 사이드바 접기/펼치기, 디자인 토큰 CSS 변수 값 (PR-2 부터 로그인 후 확인) */
test.beforeEach(async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/');
});

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

test('디자인 토큰 CSS 변수가 Penta 값으로 정의된다', async ({ page }) => {
  await page.goto('/');
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return {
      lime500: read('--lime-500'),
      ink900: read('--ink-900'),
      primary100: read('--penta-primary-100'),
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
  // 옛 Maglo 별칭은 제거됐다(디자인 PR-6) — 계산값이 비어 있고, 가리키던 Penta 값은 L1 에 그대로
  expect(tokens.lime500).toBe('');
  expect(tokens.ink900).toBe('');
  expect(tokens.primary100).toBe('#c2d9ff');
  // 셀프 호스트 Pretendard(next/font/local 이 만든 패밀리) 뒤에 로컬 'Pretendard' 대비
  expect(compact(tokens.fontBody)).toContain("'Pretendard'");
  expect(tokens.textPrimary).toBe('#111620'); // var(--penta-neutral-900)
  expect(compact(tokens.textH2)).toMatch(/^60018px\/1.*'Pretendard',/); // 600 18px/1 var(--font-body)
  expect(tokens.radiusLg).toBe('8px');
  expect(tokens.sidebarWidth).toBe('250px');
  expect(compact(tokens.hairlineSubtle)).toBe('inset0001px#eceef2'); // var(--border-subtle) = Neutral 100
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

test('UX PR-U1: 사이드바 "가격 정책" 섹션 — 가격 정책 조회·계산기, 섹션 순서 가격 정책 → 조달 → 관리자', async ({
  page,
}) => {
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: '주 메뉴' });
  const sections = sidebar.locator('nav > div');
  await expect(sections).toHaveText(['가격 정책', '조달', '관리자']);
  await expect(sidebar.getByRole('link', { name: '가격 정책 조회' })).toHaveAttribute(
    'href',
    '/pricing',
  );
  await expect(sidebar.getByRole('link', { name: '계산기' })).toHaveAttribute(
    'href',
    '/calculator',
  );
  await sidebar.getByRole('link', { name: '계산기' }).click();
  await expect(page).toHaveURL(/\/calculator$/);
  await expect(sidebar.getByRole('link', { name: '계산기' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sidebar.getByRole('link', { name: '가격 정책 조회' })).not.toHaveAttribute(
    'aria-current',
  );
});

test('UX PR-U1: 클릭 가능한 요소는 손가락 커서, 비활성은 not-allowed, 텍스트 입력은 손가락 아님 (계산된 스타일)', async ({
  page,
}) => {
  await page.goto('/');
  // 실제 셸 요소
  const cursorOf = (locator: ReturnType<typeof page.locator>) =>
    locator.evaluate((element) => getComputedStyle(element).cursor);
  expect(await cursorOf(page.getByRole('button', { name: '사이드바 접기/펼치기' }))).toBe(
    'pointer',
  );
  expect(await cursorOf(page.getByRole('link', { name: '가격 정책 조회' }))).toBe('pointer');
  // 텍스트 입력은 전역 규칙 대상이 아니다 — 브라우저 기본(text/auto), 손가락 아님
  expect(await cursorOf(page.getByRole('searchbox', { name: '통합 검색' }))).not.toBe('pointer');

  // 선택자 목록 전체 — 전역 CSS 가 적용된 문서에 표본 요소를 붙여 계산값을 읽는다
  const cursors = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button data-k="button">b</button>
      <button data-k="button-disabled" disabled>b</button>
      <button data-k="button-aria-disabled" aria-disabled="true">b</button>
      <div data-k="role-button" role="button">r</div>
      <div data-k="role-tab" role="tab">r</div>
      <div data-k="role-menuitem" role="menuitem">r</div>
      <div data-k="role-option" role="option">r</div>
      <div data-k="role-switch" role="switch">r</div>
      <details><summary data-k="summary">s</summary></details>
      <a data-k="a-href" href="#x">a</a>
      <label data-k="label-for" for="x">l</label>
      <select data-k="select"><option>o</option></select>
      <input data-k="checkbox" type="checkbox" />
      <input data-k="radio" type="radio" />
      <input data-k="range" type="range" />
      <input data-k="submit" type="submit" />
      <input data-k="text" type="text" />
      <textarea data-k="textarea"></textarea>
      <table><tbody><tr data-k="clickable-row" data-clickable=""><td>c</td></tr></tbody></table>
      <div data-k="plain-div">d</div>
      <div data-k="middle" class="cursor-grab">m</div>`;
    document.body.append(host);
    const result = Object.fromEntries(
      Array.from(host.querySelectorAll<HTMLElement>('[data-k]')).map((element) => [
        element.dataset.k,
        getComputedStyle(element).cursor,
      ]),
    );
    host.remove();
    return result;
  });
  for (const key of [
    'button',
    'role-button',
    'role-tab',
    'role-menuitem',
    'role-option',
    'role-switch',
    'summary',
    'a-href',
    'label-for',
    'select',
    'checkbox',
    'radio',
    'range',
    'submit',
    'clickable-row',
  ])
    expect(cursors[key], key).toBe('pointer');
  expect(cursors['button-disabled']).toBe('not-allowed');
  expect(cursors['button-aria-disabled']).toBe('not-allowed');
  expect(cursors.text).not.toBe('pointer');
  expect(cursors.textarea).not.toBe('pointer');
  expect(cursors['plain-div']).not.toBe('pointer');
  // 유틸리티(cursor-grab — 범위 슬라이더 가운데 드래그 #89)가 base 층 규칙보다 우선
  expect(cursors.middle).toBe('grab');
});
