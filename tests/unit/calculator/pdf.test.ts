// @vitest-environment node
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { QuoteDocument } from '@/server/quotes/document';
import { QUOTE_FONT_FILES } from '@/server/quotes/pdf/fonts';
import { PENTA_COLORS } from '@/lib/design/penta-colors';
import { PROVISIONAL_NOTICE, QUOTE_PDF_COLORS } from '@/server/quotes/pdf/QuotePdf';
import { LOGO_PATH, pdfFilename, renderQuotePdf } from '@/server/quotes/pdf/render';

/**
 * 견적서 PDF (AC-70): application/pdf 바이트, 한글 폰트 서브셋 임베드, 견적 번호·품목·합계·"가견적 · 계약가 아님" 텍스트,
 * 통화 혼합은 통화별 소계. 텍스트는 pdf.js 로 다시 추출해 확인한다 (한글 깨짐 없음의 기계 검증; 시각 스냅샷은 E2E).
 */
const document: QuoteDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  quoteNo: 'Q-2026-0042',
  title: 'WAPPLES 견적 Q-2026-0042',
  productFamily: 'WAPPLES',
  summary: 'Wapples-2700 (H2700) × 2',
  totalAmount: '30024000',
  currency: 'KRW',
  subtotals: [{ currency: 'KRW', amount: 30_024_000 }],
  createdAt: '2026-09-28T03:00:00.000Z',
  ownerName: '픽스처 사용자',
  lines: [
    {
      lineNo: 1,
      kind: 'item',
      name: 'Wapples-2700 (H2700)',
      itemCode: 'P1010010004',
      priceType: '정상판매',
      qty: 2,
      unitPrice: '27000000.00',
      currency: 'KRW',
      discountRate: '44.4',
      preDiscount: '54000000.00',
      lineTotal: '30024000.00',
      options: [
        {
          label: '파츠',
          itemCode: 'P10800011',
          name: 'N_51080 - 1G UTP 8포트(바이패스X)',
          unitPrice: 0,
          qty: 1,
        },
      ],
    },
  ],
};

async function extractText(buffer: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const chunks: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }
  return { pages: pdf.numPages, text: chunks.join('\n') };
}

/** 첫 페이지에서 쓴 채움 색(#rrggbb) — pdf.js 연산자 목록의 setFillRGBColor */
async function fillColors(buffer: Buffer): Promise<Set<string>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(1);
  const ops = await page.getOperatorList();
  const colors = new Set<string>();
  ops.fnArray.forEach((fn, index) => {
    if (fn !== pdfjs.OPS.setFillRGBColor) return;
    const args = ops.argsArray[index] as unknown[];
    const value =
      typeof args[0] === 'string'
        ? args[0]
        : `#${(args as number[])
            .slice(0, 3)
            .map((v) => Math.round(v).toString(16).padStart(2, '0'))
            .join('')}`;
    colors.add(value.toLowerCase());
  });
  return colors;
}

describe('renderQuotePdf', () => {
  it('폰트 서브셋·로고 파일이 저장소에 있다 (OFL 표기 포함)', () => {
    expect(existsSync(QUOTE_FONT_FILES.regular)).toBe(true);
    expect(existsSync(QUOTE_FONT_FILES.bold)).toBe(true);
    expect(existsSync(LOGO_PATH)).toBe(true);
    expect(existsSync(QUOTE_FONT_FILES.regular.replace(/[^\\/]+$/, 'OFL.txt'))).toBe(true);
  });

  it('AC-70: PDF 바이트 + NotoSansKR 임베드 + 한글 텍스트(견적 번호·품목·합계·가견적 문구)가 추출된다', async () => {
    const { buffer, durationMs } = await renderQuotePdf(document, {
      now: new Date('2026-09-28T03:00:00.000Z'),
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(buffer.toString('latin1')).toContain('NotoSansKR');
    const { pages, text } = await extractText(buffer);
    expect(pages).toBe(1);
    for (const needle of [
      'Q-2026-0042',
      '견 적 서',
      PROVISIONAL_NOTICE,
      'Wapples-2700 (H2700)',
      'N_51080 - 1G UTP 8포트(바이패스X)',
      '27,000,000원',
      '44.4%',
      '30,024,000원',
      '픽스처 사용자',
      '정상판매',
    ]) {
      expect(text).toContain(needle);
    }
    // 원가 관련 문구가 없다
    expect(text).not.toMatch(/원가|unit_cost|이익률/);
  }, 60_000);

  it('통화 혼합이면 단일 합계 대신 통화별 소계, 라인이 많으면 여러 페이지 (표 머리글 고정)', async () => {
    const usd = { ...document.lines[0]!, lineNo: 2, currency: 'USD', unitPrice: '10.00' };
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...document.lines[0]!,
      lineNo: index + 3,
      options: [],
    }));
    const mixed: QuoteDocument = {
      ...document,
      totalAmount: null,
      currency: null,
      subtotals: [
        { currency: 'KRW', amount: 30_024_000 },
        { currency: 'USD', amount: 11.12 },
      ],
      lines: [document.lines[0]!, usd, ...many],
    };
    const { buffer } = await renderQuotePdf(mixed);
    const { pages, text } = await extractText(buffer);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('통화별 소계');
    expect(text).toContain('11.12 USD');
    expect(text).toContain('KRW 소계');
  }, 60_000);

  it('Penta 디자인 PR-5: 견적서 색은 Penta 상수 — 본문 N900·보조 N600·합계 P600·안내 Warning 50/700, 옛 보라·임의 hex 없음', async () => {
    expect(QUOTE_PDF_COLORS).toEqual({
      ink: PENTA_COLORS['neutral-900'],
      muted: PENTA_COLORS['neutral-600'],
      line: PENTA_COLORS['neutral-200'],
      accent: PENTA_COLORS['primary-600'],
      headBg: PENTA_COLORS['neutral-100'],
      noticeBg: PENTA_COLORS['warning-50'],
      noticeFg: PENTA_COLORS['warning-700'],
    });
    const { buffer } = await renderQuotePdf(document);
    const colors = await fillColors(buffer);
    for (const color of [
      PENTA_COLORS['neutral-900'],
      PENTA_COLORS['neutral-600'],
      PENTA_COLORS['primary-600'],
      PENTA_COLORS['neutral-100'],
      PENTA_COLORS['warning-50'],
      PENTA_COLORS['warning-700'],
    ])
      expect(colors, color).toContain(color);
    for (const old of ['#7c3aed', '#141519', '#6b7280', '#fff4e5', '#f3f4f6'])
      expect(colors).not.toContain(old);
  }, 60_000);

  it('pdfFilename 은 ASCII 파일명', () => {
    expect(pdfFilename('Q-2026-0003')).toBe('Q-2026-0003.pdf');
    expect(pdfFilename('견적 A/B')).toBe('___A_B.pdf');
  });
});
