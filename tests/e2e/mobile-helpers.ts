import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 모바일 공통 단언 (모바일 UI 스펙 §6 테스트 전략). `*.mobile.spec.ts`(mobile-chromium 프로젝트)가 쓴다.
 * 설계 기준 360px, 320px 은 "깨지지 않음"(Q4).
 */
export const MOBILE_VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 320, height: 640 },
] as const;

/** 최소 터치 영역 (Q-D1-M) */
export const MIN_TOUCH = 44;

/** ① 문서 가로 넘침 0 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, '문서 가로 넘침(px)').toBeLessThanOrEqual(0);
}

/**
 * 누를 수 있는 영역 — 요소 상자에 `::before` 가 바깥으로 넓힌 만큼(보이는 크기 32 + 투명 확장, CloseButton)을 더한다.
 * Q-D1-M: 보이는 크기는 36px 까지 허용하고 나머지는 패딩이나 ::before 로 넓힌다.
 */
export async function touchTargetSize(target: Locator): Promise<{ width: number; height: number }> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let { width, height } = rect;
    const before = getComputedStyle(element, '::before');
    if (before.content !== 'none' && before.position === 'absolute') {
      const px = (value: string) => (value.endsWith('px') ? Number.parseFloat(value) : 0);
      // 음수 inset 만큼 바깥으로 커진다
      width = Math.max(width, width - px(before.left) - px(before.right));
      height = Math.max(height, height - px(before.top) - px(before.bottom));
    }
    return { width, height };
  });
}

/** ② 주요 컨트롤 터치 영역 44px 이상 */
export async function expectTouchTarget(target: Locator, name: string): Promise<void> {
  await expect(target, name).toBeVisible();
  const size = await touchTargetSize(target);
  expect(size.width, `${name} 터치 폭`).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
  expect(size.height, `${name} 터치 높이`).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
}

/** ③ 표 화면: max-md 에서 `role=table` 은 숨고 카드 `role=list` 가 보인다 (M2 부터 사용) */
export async function expectCardsInsteadOfTable(scope: Page | Locator): Promise<void> {
  await expect(scope.getByRole('table')).toHaveCount(0);
  await expect(scope.getByRole('list').first()).toBeVisible();
}

/** ④ 포커스된 입력의 글자 16px 이상 — iOS 포커스 확대 방지 */
export async function expectFocusedFieldFontSize(field: Locator): Promise<void> {
  await field.focus();
  const fontSize = await field.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(fontSize, '입력 글자 크기(px)').toBeGreaterThanOrEqual(16);
}

/** 하단 시트: 폭 전체, 화면 아래에 붙음 */
export async function expectBottomSheet(page: Page, sheet: Locator): Promise<void> {
  const viewport = page.viewportSize()!;
  // 모션이 꺼져 있어도 레이아웃이 안정될 때까지
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box ? Math.round(box.y + box.height) : null;
    })
    .toBe(viewport.height);
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.x), '시트 왼쪽').toBe(0);
  expect(Math.round(box.width), '시트 폭').toBe(viewport.width);
  expect(box.height, '시트 최대 높이 90dvh').toBeLessThanOrEqual(viewport.height * 0.9 + 1);
}

/** 배경 스크롤 잠금 표식 (components/ui/sheet-layout.ts useScrollLock) */
export async function isScrollLocked(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.hasAttribute('data-scroll-lock'));
}
