import { expect, test, type Browser, type Page } from '@playwright/test';

import { expectNoHydrationErrors, FIXTURE_USER, loginAs } from './helpers';
import {
  expectBottomSheet,
  expectFocusedFieldFontSize,
  expectNoHorizontalOverflow,
  expectTouchTarget,
  MOBILE_VIEWPORTS,
} from './mobile-helpers';

/**
 * 모바일 UI M1 공유 견적서 (docs/specs/mobile-ui.md §9, V모델 시범 — 제목은 AC ID 로 시작).
 * MOB-SR-101 품목 카드 · 102 합계 고정 · 103 공유 버튼 · 104 PDF 열고 돌아오기 · 001 공통(공유 페이지·공유 모달 기준).
 * mobile-chromium(Pixel 7)에서만 돈다. navigator.share 는 addInitScript 로 스텁(있음/없음).
 */

const ITEM_COUNT = 4;

/** 품목 여러 개를 담아 저장 — 공유 페이지에서 품목이 화면보다 길도록(MOB-SR-102.1) */
async function saveQuote(page: Page, items = ITEM_COUNT): Promise<string> {
  const list = page.getByRole('list', { name: '품목 목록' });
  for (let index = 0; index < items; index += 1) {
    await list.getByRole('button').nth(index).click();
    await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  }
  await page.getByRole('button', { name: '견적 저장' }).click();
  await expect(page.getByRole('status').filter({ hasText: '견적을 저장했습니다' })).toBeVisible();
  await expect(page.getByTestId('active-quote')).toContainText(/Q-\d{4}-\d{4}/);
  const text = await page.getByTestId('active-quote').innerText();
  return /Q-\d{4}-\d{4}/.exec(text)![0];
}

async function openShareModal(page: Page, quoteNo: string) {
  await page.getByRole('button', { name: `${quoteNo} 견적 공유` }).click();
  const dialog = page.getByRole('dialog', { name: `견적 공유 · ${quoteNo}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 공유 링크 하나 만들고 경로를 돌려준다 */
async function createShareLink(page: Page, quoteNo: string): Promise<string> {
  const dialog = await openShareModal(page, quoteNo);
  await dialog.getByRole('button', { name: '새 공유 링크 만들기' }).click();
  await expect(dialog.getByRole('status')).toContainText('공유 링크를 만들었습니다');
  const path = await dialog.getByRole('link', { name: '열기' }).first().getAttribute('href');
  expect(path).toMatch(/^\/share\/quotes\/[0-9a-f]{64}$/);
  await dialog.getByRole('button', { name: '닫기' }).click();
  await expect(dialog).toBeHidden();
  return path!;
}

/** 새 컨텍스트(비로그인 손님) — browser.newContext 는 프로젝트 use 를 물려받지 않으므로 baseURL·모바일 값을 직접 준다 */
async function guestPage(
  browser: Browser,
  viewport: { width: number; height: number },
  baseURL: string,
) {
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    locale: 'ko-KR',
  });
  return { context, page: await context.newPage() };
}

test.describe('공유 견적서 페이지', () => {
  let sharePath = '';
  let quoteNo = '';

  test.beforeAll(async ({ browser }, testInfo) => {
    const { context, page } = await guestPage(
      browser,
      MOBILE_VIEWPORTS[0],
      testInfo.project.use.baseURL!,
    );
    await loginAs(page, FIXTURE_USER, '/calculator');
    quoteNo = await saveQuote(page);
    sharePath = await createShareLink(page, quoteNo);
    await context.close();
  });

  for (const viewport of MOBILE_VIEWPORTS) {
    test(`MOB-SR-101.1·101.2·101.3·001.2·001.5: ${viewport.width}px 품목 카드·머리 정보, 가로 넘침 0, 원가 없음`, async ({
      browser,
      baseURL,
    }) => {
      const { context, page } = await guestPage(browser, viewport, baseURL!);
      await page.goto(sharePath);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(quoteNo);
      await expect(page.getByRole('table', { name: '견적 품목 표' })).toBeHidden();
      const cards = page.getByRole('list', { name: '견적 품목' }).getByRole('listitem');
      await expect(cards).toHaveCount(ITEM_COUNT);
      for (const card of await cards.all()) {
        await expect(card).toBeVisible();
        // 품목명 · 수량 × 단가 · 할인 · 금액
        await expect(card).toContainText(/\d+ × [\d,]+(원|\$|USD)/);
        await expect(card).toContainText(/할인 \d+(\.\d+)?%/);
      }
      // 카드 안 글자는 12px 이상 (11px 이하 금지, §4)
      const smallest = await page.getByRole('list', { name: '견적 품목' }).evaluate((list) =>
        Math.min(
          ...Array.from(list.querySelectorAll<HTMLElement>('*'))
            .filter((element) => element.childElementCount === 0 && element.textContent?.trim())
            .map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
        ),
      );
      expect(smallest).toBeGreaterThanOrEqual(12);
      // 머리 정보 2열, 라벨 12px
      const labels = page.locator('dl dt');
      await expect(labels).toHaveCount(4);
      for (const label of await labels.all())
        expect(
          await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
        ).toBeGreaterThanOrEqual(12);
      await expectNoHorizontalOverflow(page);
      expect(await page.locator('body').innerText()).not.toMatch(/원가|이익률/);
      expectNoHydrationErrors(page);
      await context.close();
    });
  }

  test('MOB-SR-102.1·102.2: 360px 합계는 스크롤 중 화면 아래에 보이고, 맨 아래에서 마지막 카드·안내 문구를 가리지 않는다', async ({
    browser,
    baseURL,
  }) => {
    // 품목 4개가 화면보다 길도록 낮은 높이
    const { context, page } = await guestPage(browser, { width: 360, height: 520 }, baseURL!);
    await page.goto(sharePath);
    const total = page.getByRole('region', { name: '견적 합계' });
    await expect(total).toBeVisible();
    const lastCard = page.getByRole('list', { name: '견적 품목' }).getByRole('listitem').last();
    // 맨 위: 마지막 카드는 아직 화면 밖인데 합계는 화면 아래에 붙어 있다
    await expect(lastCard).not.toBeInViewport();
    let box = (await total.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(520);
    await expect(total).toBeInViewport({ ratio: 0.99 });
    // 중간쯤
    await page.mouse.wheel(0, 200);
    await expect(total).toBeInViewport({ ratio: 0.99 });
    // 맨 아래: 합계가 제자리(마지막 카드 아래)로 돌아가 카드·안내 문구가 보인다
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const note = page.getByText(
      '본 견적서는 Prami 계산기로 산출한 가견적이며 계약 금액이 아닙니다.',
    );
    await expect(note).toBeInViewport({ ratio: 0.99 });
    box = (await total.boundingBox())!;
    const cardBox = (await lastCard.boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(box.y + 0.5);
    const noteBox = (await note.boundingBox())!;
    expect(noteBox.y).toBeGreaterThanOrEqual(box.y + box.height - 0.5);
    await context.close();
  });
});

test.describe('공유 모달 · PDF (360px)', () => {
  test.use({ viewport: MOBILE_VIEWPORTS[0] });

  test('MOB-SR-103.1·103.5·001.3·001.4: navigator.share 가 있으면 [공유] 로 제목·절대 URL 공유(금액 없음), 링크 행 버튼 44px', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const calls: ShareData[] = [];
      Object.assign(window, { __shareCalls: calls });
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          calls.push(data);
        },
      });
    });
    await loginAs(page, FIXTURE_USER, '/calculator');
    const quoteNo = await saveQuote(page, 1);
    const dialog = await openShareModal(page, quoteNo);
    await expectBottomSheet(page, dialog);
    await expectFocusedFieldFontSize(dialog.getByLabel('만료 (일)'));
    await dialog.getByRole('button', { name: '새 공유 링크 만들기' }).click();
    await expect(dialog.getByRole('status')).toContainText('공유 링크를 만들었습니다');
    const row = dialog.getByRole('list', { name: '공유 링크 목록' }).getByRole('listitem').first();
    const path = await row.getByRole('link', { name: '열기' }).getAttribute('href');
    for (const [control, name] of [
      [row.getByRole('button', { name: '공유' }), '공유'],
      [row.getByRole('button', { name: '링크 복사' }), '링크 복사'],
      [row.getByRole('link', { name: '열기' }), '열기'],
      [row.getByRole('button', { name: /폐기$/ }), '폐기'],
    ] as const)
      await expectTouchTarget(control, name);
    await expectNoHorizontalOverflow(page);

    await row.getByRole('button', { name: '공유' }).click();
    const calls = await page.evaluate(
      () => (window as unknown as { __shareCalls: ShareData[] }).__shareCalls,
    );
    const origin = new URL(page.url()).origin;
    expect(calls).toEqual([{ title: `Prami 견적서 ${quoteNo}`, url: `${origin}${path}` }]);
    expect(JSON.stringify(calls)).not.toMatch(/원|KRW|\d{1,3}(,\d{3})+/);
    expectNoHydrationErrors(page);
  });

  test('MOB-SR-103.4: navigator.share 가 없으면 [공유] 없음, [링크 복사]·[열기]·[폐기] 그대로', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, 'share');
    });
    await loginAs(page, FIXTURE_USER, '/calculator');
    const quoteNo = await saveQuote(page, 1);
    const dialog = await openShareModal(page, quoteNo);
    await dialog.getByRole('button', { name: '새 공유 링크 만들기' }).click();
    await expect(dialog.getByRole('status')).toContainText('공유 링크를 만들었습니다');
    const row = dialog.getByRole('list', { name: '공유 링크 목록' }).getByRole('listitem').first();
    await expect(row.getByRole('button', { name: '공유' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '링크 복사' })).toBeVisible();
    await expect(row.getByRole('link', { name: '열기' })).toBeVisible();
    await expect(row.getByRole('button', { name: /폐기$/ })).toBeVisible();
  });

  test('MOB-SR-104.1: [견적서 출력] 은 새 탭으로 PDF, 원래 탭의 URL·장바구니는 그대로', async ({
    page,
  }) => {
    await loginAs(page, FIXTURE_USER, '/calculator');
    const quoteNo = await saveQuote(page, 1);
    const before = page.url();
    const cart = page.getByRole('region', { name: '장바구니' }).or(page.getByLabel('장바구니'));
    const cartText = await cart.first().innerText();
    const pdfLink = page.getByRole('link', { name: `${quoteNo} 견적서 출력` });
    await expect(pdfLink).toHaveAttribute('target', '_blank');
    // 새 탭의 URL 은 PDF 를 받는 동안 비어 있을 수 있다(headless) — 컨텍스트에서 PDF 응답을 본다
    const pdfResponse = page
      .context()
      .waitForEvent('response', (response) =>
        /\/api\/quotes\/[^/]+\/pdf$/.test(new URL(response.url()).pathname),
      );
    const [popup] = await Promise.all([page.waitForEvent('popup'), pdfLink.click()]);
    const response = await pdfResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect(response.frame().page()).toBe(popup);
    await popup.close();
    await page.bringToFront();
    expect(page.url()).toBe(before);
    expect(await cart.first().innerText()).toBe(cartText);
  });
});
