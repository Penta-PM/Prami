import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import { PENTA_COLORS } from '@/lib/design/penta-colors';
import { priceLabel } from '@/lib/pricing/format';

import type { QuoteDocument, QuoteDocumentLine } from '../document';
import { QUOTE_FONT_FAMILY } from './fonts';

/**
 * A4 견적서 (§4.5.8, Q-05 간단 양식): 로고 · 견적 번호 · 일자 · 품목/수량/단가/할인/금액 · 합계 · "가견적 · 계약가 아님".
 * 회사 양식 파일이 오면 이 레이아웃만 교체한다. 원가는 문서 모델에 없으므로 여기서도 나올 수 없다.
 */
export const PROVISIONAL_NOTICE = '가견적 · 계약가 아님';
export const PROVISIONAL_FOOTER =
  '본 견적서는 Prami 가격정책 통합 관리 플랫폼의 계산기로 산출한 가견적이며 계약 금액이 아닙니다. 실제 계약 조건은 담당 영업과 확인하십시오.';

/**
 * 견적서 색 (Penta 디자인 PR-5). React-PDF 는 CSS 변수를 못 읽어 Penta L1 상수(globals.css 와 같은 값)를 쓴다.
 * 글자 단계는 화면과 같은 규칙: 본문 Neutral 900 · 보조 Neutral 600 · 합계 강조 Primary 600 · 안내 배지 Warning 50 + 700.
 */
export const QUOTE_PDF_COLORS = {
  ink: PENTA_COLORS['neutral-900'],
  muted: PENTA_COLORS['neutral-600'],
  line: PENTA_COLORS['neutral-200'],
  accent: PENTA_COLORS['primary-600'],
  headBg: PENTA_COLORS['neutral-100'],
  noticeBg: PENTA_COLORS['warning-50'],
  noticeFg: PENTA_COLORS['warning-700'],
} as const;

const INK = QUOTE_PDF_COLORS.ink;
const MUTED = QUOTE_PDF_COLORS.muted;
const LINE = QUOTE_PDF_COLORS.line;
const ACCENT = QUOTE_PDF_COLORS.accent;

const styles = StyleSheet.create({
  page: {
    fontFamily: QUOTE_FONT_FAMILY,
    fontSize: 9,
    color: INK,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 28, height: 28 },
  wordmark: { fontSize: 16, fontWeight: 700 },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: 2 },
  notice: {
    marginTop: 6,
    alignSelf: 'flex-end',
    borderRadius: 4,
    backgroundColor: QUOTE_PDF_COLORS.noticeBg,
    color: QUOTE_PDF_COLORS.noticeFg,
    paddingVertical: 3,
    paddingHorizontal: 8,
    fontSize: 8,
    fontWeight: 700,
  },
  meta: {
    marginTop: 18,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: LINE,
    paddingVertical: 8,
  },
  metaCell: { flex: 1 },
  metaLabel: { color: MUTED, fontSize: 7.5, marginBottom: 2 },
  metaValue: { fontSize: 10, fontWeight: 700 },
  table: { marginTop: 16 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINE, paddingVertical: 5 },
  head: { backgroundColor: QUOTE_PDF_COLORS.headBg, borderBottomWidth: 1, fontWeight: 700 },
  colNo: { width: 22 },
  colName: { flex: 1, paddingRight: 6 },
  colType: { width: 62 },
  colQty: { width: 34, textAlign: 'right' },
  colUnit: { width: 78, textAlign: 'right' },
  colRate: { width: 42, textAlign: 'right' },
  colTotal: { width: 84, textAlign: 'right', fontWeight: 700 },
  sub: { color: MUTED, fontSize: 7.5, marginTop: 2 },
  totals: { marginTop: 14, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', gap: 16, alignItems: 'baseline' },
  totalLabel: { color: MUTED },
  totalValue: { fontSize: 16, fontWeight: 700, color: ACCENT },
  footer: {
    position: 'absolute',
    left: 40,
    right: 40,
    bottom: 28,
    borderTopWidth: 0.5,
    borderColor: LINE,
    paddingTop: 6,
    color: MUTED,
    fontSize: 7,
  },
  pageNo: { position: 'absolute', right: 40, bottom: 14, color: MUTED, fontSize: 7 },
});

/** 로고는 바이트로 넘긴다 — 문자열 경로는 Windows 드라이브(`C:`)가 URL 스킴으로 읽혀 렌더되지 않는다 */
export type PdfImage = { data: Buffer; format: 'png' | 'jpg' };

export type QuotePdfProps = { document: QuoteDocument; logo: PdfImage; generatedAt: Date };

function dateLabel(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function LineRow({ line }: { line: QuoteDocumentLine }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.colNo}>{line.lineNo}</Text>
      <View style={styles.colName}>
        <Text>{line.name}</Text>
        {line.itemCode ? <Text style={styles.sub}>{line.itemCode}</Text> : null}
        {line.options.map((option, index) => (
          <Text key={`${option.itemCode}-${index}`} style={styles.sub}>
            {`+ ${option.label} ${option.name} (${option.itemCode})`}
            {option.qty > 1 ? ` × ${option.qty}` : ''}
            {` · ${priceLabel(option.unitPrice, line.currency)}`}
          </Text>
        ))}
      </View>
      <Text style={styles.colType}>{line.priceType ?? (line.kind === 'group' ? '그룹' : '—')}</Text>
      <Text style={styles.colQty}>{line.qty}</Text>
      <Text style={styles.colUnit}>{priceLabel(line.unitPrice, line.currency)}</Text>
      <Text style={styles.colRate}>{`${Number(line.discountRate)}%`}</Text>
      <Text style={styles.colTotal}>{priceLabel(line.lineTotal, line.currency)}</Text>
    </View>
  );
}

function Totals({ document }: { document: QuoteDocument }) {
  if (document.totalAmount !== null && document.currency) {
    return (
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>합계 (할인 반영)</Text>
        <Text style={styles.totalValue}>{priceLabel(document.totalAmount, document.currency)}</Text>
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.totalLabel}>통화가 섞여 있어 통화별 소계로 표시합니다</Text>
      {document.subtotals.map((subtotal) => (
        <View key={subtotal.currency} style={styles.totalRow}>
          <Text style={styles.totalLabel}>{subtotal.currency} 소계</Text>
          <Text style={styles.totalValue}>{priceLabel(subtotal.amount, subtotal.currency)}</Text>
        </View>
      ))}
    </View>
  );
}

export function QuotePdf({ document, logo, generatedAt }: QuotePdfProps) {
  return (
    <Document
      title={`${document.quoteNo} ${document.title}`}
      author="Prami"
      subject={PROVISIONAL_NOTICE}
      language="ko"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image 에는 alt 가 없다 */}
            <Image src={logo} style={styles.logo} />
            <Text style={styles.wordmark}>Prami</Text>
          </View>
          <View>
            <Text style={styles.title}>견 적 서</Text>
            <Text style={styles.notice}>{PROVISIONAL_NOTICE}</Text>
          </View>
        </View>
        <View style={styles.meta}>
          <MetaCell label="견적 번호" value={document.quoteNo} />
          <MetaCell label="견적 일자" value={dateLabel(document.createdAt)} />
          <MetaCell label="제품군" value={document.productFamily ?? '—'} />
          <MetaCell label="작성자" value={document.ownerName} />
        </View>
        <Text style={{ marginTop: 14, fontSize: 11, fontWeight: 700 }}>{document.title}</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.head]} fixed>
            <Text style={styles.colNo}>No</Text>
            <Text style={styles.colName}>품목</Text>
            <Text style={styles.colType}>단가유형</Text>
            <Text style={styles.colQty}>수량</Text>
            <Text style={styles.colUnit}>단가</Text>
            <Text style={styles.colRate}>할인</Text>
            <Text style={styles.colTotal}>금액</Text>
          </View>
          {document.lines.map((line) => (
            <LineRow key={line.lineNo} line={line} />
          ))}
        </View>
        <View style={styles.totals}>
          <Totals document={document} />
        </View>
        <View style={styles.footer} fixed>
          <Text>{PROVISIONAL_FOOTER}</Text>
          <Text style={{ marginTop: 3 }}>{`생성 ${dateLabel(generatedAt)} · Prami`}</Text>
        </View>
        <Text
          style={styles.pageNo}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  );
}
