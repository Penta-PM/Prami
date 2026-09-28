import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * PR-8 견적서 PDF · 공유 (AC-70~72, QA-08):
 * - AC-70: 소유자가 PDF Route 로 application/pdf 를 받고, pdf.js 로 한글 텍스트를 추출·캔버스에 그려 시각 스냅샷을 남긴다.
 * - AC-72: 남의 견적 PDF 는 403.
 * - AC-71: 공유 링크는 비로그인 컨텍스트에서 열리고(원가 없음), 폐기하면 404. 없는 토큰도 404.
 */
const PDFJS_DIR = path.resolve('node_modules/pdfjs-dist/build');

async function saveFirstItemQuote(page: Page): Promise<string> {
  await page.getByRole('list', { name: '품목 목록' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /장바구니에 담기 \(/ }).click();
  await page.getByRole('button', { name: '견적 저장' }).click();
  await expect(page.getByRole('status')).toContainText('견적을 저장했습니다');
  // 목록 갱신 뒤에 출력·공유 대상이 정해진다 — 번호가 보일 때까지 기다린다
  await expect(page.getByTestId('active-quote')).toContainText(/Q-\d{4}-\d{4}/);
  const text = await page.getByTestId('active-quote').innerText();
  const quoteNo = /Q-\d{4}-\d{4}/.exec(text)?.[0];
  if (!quoteNo) throw new Error(`출력·공유 대상 견적 번호를 찾을 수 없습니다: ${text}`);
  return quoteNo;
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

/** 브라우저 안에서 pdf.js 로 1페이지를 캔버스에 그린다 (시각 스냅샷용) */
async function renderPdfToCanvas(page: Page, bytes: Buffer): Promise<void> {
  const lib = readFileSync(path.join(PDFJS_DIR, 'pdf.min.mjs'), 'utf8');
  const worker = readFileSync(path.join(PDFJS_DIR, 'pdf.worker.min.mjs'), 'utf8');
  await page.goto('about:blank');
  await page.setContent(
    '<html><body style="margin:0;background:#888"><canvas id="pdf"></canvas></body></html>',
  );
  await page.evaluate(
    async ({ libSource, workerSource, base64 }) => {
      const blobUrl = (source: string) =>
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const pdfjs = (await import(/* @vite-ignore */ blobUrl(libSource))) as {
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (options: { data: Uint8Array }) => {
          promise: Promise<{
            getPage: (index: number) => Promise<{
              getViewport: (options: { scale: number }) => { width: number; height: number };
              render: (options: {
                canvasContext: CanvasRenderingContext2D;
                viewport: { width: number; height: number };
              }) => { promise: Promise<void> };
            }>;
          }>;
        };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = blobUrl(workerSource);
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const pdf = await pdfjs.getDocument({ data }).promise;
      const first = await pdf.getPage(1);
      const viewport = first.getViewport({ scale: 1.5 });
      const canvas = document.getElementById('pdf') as HTMLCanvasElement;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await first.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    },
    { libSource: lib, workerSource: worker, base64: bytes.toString('base64') },
  );
}

test('AC-70/72: 소유자 PDF 200(한글 텍스트·시각 스냅샷), 남의 견적 PDF 403', async ({
  page,
  browser,
}, testInfo) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  const quoteNo = await saveFirstItemQuote(page);
  const link = page.getByRole('link', { name: `${quoteNo} 견적서 출력` });
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/api\/quotes\/[0-9a-f-]{36}\/pdf$/);

  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  expect(response.headers()['content-disposition']).toBe(`inline; filename="${quoteNo}.pdf"`);
  const renderMs = Number(response.headers()['x-render-ms']);
  expect(renderMs).toBeGreaterThanOrEqual(0);
  const bytes = await response.body();
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await testInfo.attach('quote.pdf', { body: bytes, contentType: 'application/pdf' });
  testInfo.annotations.push({ type: 'pdf-render-ms', description: String(renderMs) });

  const text = await extractPdfText(bytes);
  expect(text).toContain(quoteNo);
  expect(text).toContain('견 적 서');
  expect(text).toContain('가견적 · 계약가 아님');
  expect(text).toContain('정상판매');
  expect(text).not.toMatch(/원가|이익률/);

  const viewer = await browser.newPage();
  await renderPdfToCanvas(viewer, bytes);
  const shot = await viewer.locator('#pdf').screenshot();
  await testInfo.attach('quote-pdf-page1.png', { body: shot, contentType: 'image/png' });
  expect(shot.byteLength).toBeGreaterThan(10_000);
  await viewer.close();

  // AC-72: ADMIN 이 저장한 견적을 USER 가 요청하면 403 (JSON 봉투)
  await page.context().clearCookies();
  await loginAs(page, FIXTURE_ADMIN, '/calculator');
  const adminQuoteNo = await saveFirstItemQuote(page);
  const adminHref = await page
    .getByRole('link', { name: `${adminQuoteNo} 견적서 출력` })
    .getAttribute('href');
  await page.context().clearCookies();
  await loginAs(page, FIXTURE_USER, '/calculator');
  const forbidden = await page.request.get(adminHref!);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  // ADMIN 은 남의 견적 PDF 도 200
  await page.context().clearCookies();
  await loginAs(page, FIXTURE_ADMIN, '/calculator');
  expect((await page.request.get(href!)).status()).toBe(200);
});

test('AC-71: 공유 링크 비로그인 열람(원가 없음) → 폐기 후 404, 없는 토큰 404', async ({
  page,
  browser,
}) => {
  await loginAs(page, FIXTURE_USER, '/calculator');
  const quoteNo = await saveFirstItemQuote(page);
  await page.getByRole('button', { name: `${quoteNo} 견적 공유` }).click();
  const dialog = page.getByRole('dialog', { name: `견적 공유 · ${quoteNo}` });
  await dialog.getByRole('button', { name: '새 공유 링크 만들기' }).click();
  await expect(dialog.getByRole('status')).toContainText('공유 링크를 만들었습니다');
  const sharePath = await dialog.getByRole('link', { name: '열기' }).getAttribute('href');
  expect(sharePath).toMatch(/^\/share\/quotes\/[0-9a-f]{64}$/);

  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  const shared = await guest.goto(sharePath!);
  expect(shared?.status()).toBe(200);
  await expect(guest).toHaveURL(new RegExp(`${sharePath}$`));
  await expect(guest.getByRole('heading', { level: 1 })).toContainText(quoteNo);
  await expect(guest.getByText('가견적 · 계약가 아님')).toBeVisible();
  await expect(guest.getByRole('table', { name: '견적 품목 표' })).toBeVisible();
  await expect(guest.getByTestId('share-total')).toContainText('원');
  expect(await guest.locator('body').innerText()).not.toMatch(/원가|이익률|로그인/);

  await dialog.getByRole('button', { name: /폐기$/ }).click();
  await expect(dialog.getByRole('status')).toContainText('공유 링크를 폐기했습니다');
  const revoked = await guest.goto(sharePath!);
  expect(revoked?.status()).toBe(404);
  const missing = await guest.goto(`/share/quotes/${'0'.repeat(64)}`);
  expect(missing?.status()).toBe(404);
  await anonymous.close();
});
