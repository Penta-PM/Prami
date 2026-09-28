import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';

import type { QuoteDocument } from '../document';
import { registerQuoteFonts } from './fonts';
import { QuotePdf, type PdfImage } from './QuotePdf';

/**
 * 견적서 PDF 렌더 (서버, @react-pdf/renderer). 렌더 시간을 함께 돌려주어 Route 가 감사 로그·응답 헤더에 남긴다
 * (Vercel 서버리스 실행시간 제약 확인용 — 로컬 측정치는 PR 본문에 기록).
 */
export const LOGO_PATH = path.join(process.cwd(), 'public', 'logo-prami-mark.png');

export type RenderedPdf = { buffer: Buffer; durationMs: number };

let cachedLogo: PdfImage | null = null;

/** 로고 PNG 바이트 (프로세스당 1회 읽기) */
export function loadLogo(logoPath: string = LOGO_PATH): PdfImage {
  if (cachedLogo && logoPath === LOGO_PATH) return cachedLogo;
  const image: PdfImage = { data: readFileSync(logoPath), format: 'png' };
  if (logoPath === LOGO_PATH) cachedLogo = image;
  return image;
}

export async function renderQuotePdf(
  document: QuoteDocument,
  options: { logoPath?: string; now?: Date } = {},
): Promise<RenderedPdf> {
  registerQuoteFonts();
  const started = performance.now();
  // QuotePdf 의 루트는 <Document> 이지만 함수 컴포넌트 요소라 renderToBuffer 의 타입(DocumentProps)과 맞지 않아 캐스팅한다
  const element = createElement(QuotePdf, {
    document,
    logo: loadLogo(options.logoPath),
    generatedAt: options.now ?? new Date(),
  }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return { buffer: Buffer.from(buffer), durationMs: Math.round(performance.now() - started) };
}

/** 첨부 파일 이름: `Q-2026-0003.pdf` (ASCII 만이라 Content-Disposition 인코딩이 필요 없다) */
export function pdfFilename(quoteNo: string): string {
  return `${quoteNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
}
