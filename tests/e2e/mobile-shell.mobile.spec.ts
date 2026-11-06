import { expect, test, type Page } from '@playwright/test';

import { expectNoHydrationErrors, FIXTURE_USER, loginAs } from './helpers';
import {
  expectBottomSheet,
  expectFocusedFieldFontSize,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  isScrollLocked,
  MOBILE_VIEWPORTS,
} from './mobile-helpers';

/**
 * 모바일 UI M0 기반 (docs/specs/mobile-ui.md §5 M0·§6): 헤더 56px·☰·검색 펼침·아바타 계정 시트(설정 진입 결함 수정),
 * 사이드바 오버레이(배경 잠금·inert), Modal·Drawer·Popover 의 max-md 하단 시트. mobile-chromium(Pixel 7, 터치)에서만 돈다.
 */

const header = (page: Page) => page.getByRole('banner');

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test('로그인 화면: 가로 넘침 0, 입력 16px', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('form', { name: '테스트 계정 로그인' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectFocusedFieldFontSize(page.getByLabel('이메일'));
    });

    test('헤더 56px · 터치 44px · 검색 펼침 · 계정 시트 → 사용자 설정', async ({ page }) => {
      await loginAs(page, FIXTURE_USER, '/');
      await expect(page.getByRole('heading', { level: 1, name: 'HOME' })).toBeVisible();
      expect(Math.round((await header(page).boundingBox())!.height)).toBe(56);
      await expectNoHorizontalOverflow(page);

      await expectTouchTarget(page.getByRole('button', { name: '메뉴 열기' }), '☰');
      await expectTouchTarget(header(page).getByRole('button', { name: '검색 열기' }), '검색');
      await expectTouchTarget(header(page).getByRole('button', { name: /^알림/ }), '알림');
      await expectTouchTarget(header(page).getByRole('button', { name: '계정 메뉴' }), '아바타');
      // 데스크톱 전용 사용자 표시·설정 링크·로그아웃은 숨는다(시트로 옮김)
      await expect(header(page).getByRole('link', { name: '사용자 설정' })).toBeHidden();
      await expect(header(page).getByRole('button', { name: '로그아웃' })).toBeHidden();

      // 검색: 아이콘 → 펼침(포커스, 16px) → 닫기
      const searchbox = page.getByRole('searchbox', { name: '통합 검색' });
      await expect(searchbox).toBeHidden();
      await header(page).getByRole('button', { name: '검색 열기' }).click();
      await expect(searchbox).toBeFocused();
      await expectFocusedFieldFontSize(searchbox);
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
      await expect(searchbox).toBeHidden();
      await expect(header(page).getByRole('button', { name: '검색 열기' })).toBeFocused();

      // 계정 시트: 이름·역할, 닫기 44px, 사용자 설정으로 이동
      await header(page).getByRole('button', { name: '계정 메뉴' }).click();
      const sheet = page.getByRole('dialog', { name: '계정' });
      await expect(sheet).toBeVisible();
      await expectBottomSheet(page, sheet);
      expect(await isScrollLocked(page)).toBe(true);
      await expectTouchTarget(sheet.getByRole('button', { name: '닫기' }), '닫기');
      await expectTouchTarget(sheet.getByRole('link', { name: '사용자 설정' }), '사용자 설정');
      await expectTouchTarget(sheet.getByRole('button', { name: '로그아웃' }), '로그아웃');
      await expectNoHorizontalOverflow(page);

      await sheet.getByRole('link', { name: '사용자 설정' }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('heading', { level: 1, name: '사용자 설정' })).toBeVisible();
      await expect(sheet).toBeHidden();
      await expect.poll(() => isScrollLocked(page)).toBe(false);
      expectNoHydrationErrors(page);
    });

    test('사이드바 오버레이: 뒤 콘텐츠 inert + 배경 잠금, Esc 로 닫힘', async ({ page }) => {
      await loginAs(page, FIXTURE_USER, '/');
      const sidebar = page.getByRole('complementary', { name: '주 메뉴' });
      await expect(sidebar).toBeHidden();
      await page.getByRole('button', { name: '메뉴 열기' }).click();
      await expect(sidebar).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const contentInert = () =>
        page.evaluate(() => document.getElementById('app-content')?.hasAttribute('inert'));
      expect(await contentInert()).toBe(true);
      expect(await isScrollLocked(page)).toBe(true);

      await page.keyboard.press('Escape');
      await expect(sidebar).toBeHidden();
      expect(await contentInert()).toBe(false);
      expect(await isScrollLocked(page)).toBe(false);
      await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeFocused();
    });

    test('모달은 하단 시트로 열리고 닫기 버튼(44px)으로 닫힌다', async ({ page }) => {
      await loginAs(page, FIXTURE_USER, '/settings');
      await page.getByRole('button', { name: '저장된 화면·입력 초기화' }).click();
      const dialog = page.getByRole('dialog', { name: '저장된 화면·입력 초기화' });
      await expect(dialog).toBeVisible();
      await expectBottomSheet(page, dialog);
      expect(await isScrollLocked(page)).toBe(true);
      // 푸터는 고정이고 본문만 스크롤한다
      await expect(dialog.getByRole('button', { name: '초기화' })).toBeInViewport({ ratio: 0.99 });
      await expectNoHorizontalOverflow(page);
      const close = dialog.getByRole('button', { name: '닫기' });
      await expectTouchTarget(close, '닫기');
      await close.click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => isScrollLocked(page)).toBe(false);
    });
  });
}

test.describe('360px 드로어·팝오버', () => {
  test.use({ viewport: MOBILE_VIEWPORTS[0] });

  test('행 상세 드로어와 빠른 필터 팝오버가 하단 시트로 열린다', async ({ page }) => {
    await loginAs(page, FIXTURE_USER, '/pricing?q=P2002030005');
    // 표 → 카드는 M2 — 지금은 가로 스크롤 표의 행을 누른다
    await page.getByRole('table', { name: '가격정책 표' }).locator('tbody tr').first().click();
    const drawer = page.getByRole('dialog', { name: '행 상세' });
    await expect(drawer).toBeVisible();
    await expectBottomSheet(page, drawer);
    expect(await isScrollLocked(page)).toBe(true);
    const closeDrawer = drawer.getByRole('button', { name: '닫기' });
    await expectTouchTarget(closeDrawer, '드로어 닫기');
    await closeDrawer.click();
    await expect(drawer).toBeHidden();
    await expect.poll(() => isScrollLocked(page)).toBe(false);

    await page.locator('[data-quick-filter-bar] [data-quick-field]').first().click();
    const popover = page.getByRole('dialog', { name: / 필터$/ });
    await expect(popover).toBeVisible();
    await expectBottomSheet(page, popover);
    expect(await isScrollLocked(page)).toBe(true);
    const closePopover = popover.getByRole('button', { name: '닫기' });
    await expectTouchTarget(closePopover, '팝오버 닫기');
    await closePopover.click();
    await expect(popover).toBeHidden();
    await expect.poll(() => isScrollLocked(page)).toBe(false);
    expectNoHydrationErrors(page);
  });
});
