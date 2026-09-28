import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import type { Db } from '@/db';
import { salesPrices } from '@/db/schema';
import { AppError } from '@/lib/result';

import type { quoteLineSchema } from './schemas';

/**
 * 서버 재가격화 (PR-7 QA MEDIUM → PR-8 선행): 클라이언트가 보낸 단가 스냅샷을 믿지 않고
 * 품목·파츠·결합형·그룹 상세의 단가를 DB 의 운영중 최신 행으로 다시 확정한다 (§4.3.8 "가격은 서버가 DB 에서 확정").
 * - 본품: (품번, 선택 단가유형) 최신 행. 없으면 저장 거부(VALIDATION).
 * - 파츠·결합형: (품번, 선택 단가유형) → 없으면 (품번, 정상판매) — STEP4 후보 조회(listQuoteParts)와 같은 규칙. 둘 다 없으면 거부.
 * - 그룹 라인: 하드웨어·상세 제품은 정상판매 최신 행(PR-6 그룹 칩과 동일). 없는 품번은 파츠·결합형과 같이 거부 (PR-8 QA LOW-2).
 * - 품명(본품·파츠·결합형·상세)도 DB 행의 품명으로 대체한다 — 클라이언트 문구가 견적서·공유 페이지에 실리지 않도록 (PR-8 QA LOW-1).
 * 클라이언트 값과 다르면 서버 값으로 대체하고 `adjustments` 로 알려 준다 (거부 대신 보정 — 담기로 복원한 옛 스냅샷도 저장 가능).
 */
export type ParsedQuoteLine = z.output<typeof quoteLineSchema>;

export type PriceAdjustment = {
  lineNo: number;
  name: string;
  itemCode: string;
  field: 'unitPrice' | 'currency' | 'name';
  client: string;
  server: string;
};

export type RepriceResult = {
  lines: ParsedQuoteLine[];
  adjustments: PriceAdjustment[];
  /** 라인 본품이 속한 제품군(중복 제거, 등장 순) */
  families: string[];
};

export const NORMAL_PRICE_TYPE = '정상판매';

type LatestPrice = {
  unitPrice: number;
  currency: string;
  productFamily: string | null;
  itemName: string;
};
type PriceMap = Map<string, LatestPrice>;

const key = (itemCode: string, priceType: string) => `${itemCode}\u0000${priceType}`;

function collectCodes(lines: readonly ParsedQuoteLine[]): { codes: string[]; types: string[] } {
  const codes = new Set<string>();
  const types = new Set<string>([NORMAL_PRICE_TYPE]);
  for (const line of lines) {
    if (line.itemCode) codes.add(line.itemCode);
    if (line.priceType) types.add(line.priceType);
    for (const option of [...line.parts, ...line.bundles, ...line.groupItems]) {
      codes.add(option.itemCode);
    }
  }
  return { codes: [...codes], types: [...types] };
}

/** (품번, 단가유형)별 운영중 최신 행 */
async function loadLatestPrices(db: Db, codes: string[], types: string[]): Promise<PriceMap> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode, salesPrices.priceType], {
      itemCode: salesPrices.itemCode,
      priceType: salesPrices.priceType,
      unitPrice: salesPrices.unitPrice,
      currency: salesPrices.currency,
      productFamily: salesPrices.productFamily,
      itemName: salesPrices.itemName,
    })
    .from(salesPrices)
    .where(
      and(
        isNull(salesPrices.deletedAt),
        eq(salesPrices.operationStatus, '운영중'),
        inArray(salesPrices.itemCode, codes),
        inArray(salesPrices.priceType, types),
      ),
    )
    .orderBy(
      salesPrices.itemCode,
      salesPrices.priceType,
      desc(salesPrices.effectiveFrom),
      desc(salesPrices.id),
    );
  return new Map(
    rows.flatMap((row) =>
      row.priceType
        ? [
            [
              key(row.itemCode, row.priceType),
              {
                unitPrice: Number(row.unitPrice),
                itemName: row.itemName.trim(),
                currency: row.currency,
                productFamily: row.productFamily,
              },
            ] as const,
          ]
        : [],
    ),
  );
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

type OptionLike = { itemCode: string; itemName: string; unitPrice: number };

class Repricer {
  readonly adjustments: PriceAdjustment[] = [];
  readonly families: string[] = [];

  constructor(private readonly prices: PriceMap) {}

  private note(
    line: ParsedQuoteLine,
    lineNo: number,
    itemCode: string,
    field: PriceAdjustment['field'],
    client: string,
    server: string,
  ) {
    if (client !== server) {
      this.adjustments.push({ lineNo, name: line.name, itemCode, field, client, server });
    }
  }

  /** 본품(또는 그룹 하드웨어) 단가·통화 확정 */
  private base(
    line: ParsedQuoteLine,
    lineNo: number,
  ): Pick<ParsedQuoteLine, 'unitPrice' | 'currency' | 'name'> {
    if (!line.itemCode) {
      // 하드웨어 없는 그룹 라인: 본품 단가는 0 이어야 한다
      this.note(line, lineNo, '', 'unitPrice', String(line.unitPrice), '0');
      return { unitPrice: 0, currency: line.currency, name: line.name };
    }
    const priceType = line.kind === 'group' ? NORMAL_PRICE_TYPE : (line.priceType ?? '');
    const found = this.prices.get(key(line.itemCode, priceType));
    if (!found) {
      throw new AppError(
        'VALIDATION',
        `품목 ${line.name}(${line.itemCode})의 '${priceType || '단가유형 없음'}' 운영중 단가를 찾을 수 없습니다`,
        { lines: [`라인 ${lineNo}: 단가 없음`] },
      );
    }
    if (found.productFamily && !this.families.includes(found.productFamily)) {
      this.families.push(found.productFamily);
    }
    if (!sameAmount(found.unitPrice, line.unitPrice)) {
      this.note(
        line,
        lineNo,
        line.itemCode,
        'unitPrice',
        String(line.unitPrice),
        String(found.unitPrice),
      );
    }
    this.note(line, lineNo, line.itemCode, 'currency', line.currency, found.currency);
    // 그룹 라인 이름은 '그룹명 · 하드웨어' 조합이라 유지, 품목 라인은 DB 품명으로 대체 (LOW-1)
    const name = line.kind === 'item' ? found.itemName : line.name;
    this.note(line, lineNo, line.itemCode, 'name', line.name, name);
    return { unitPrice: found.unitPrice, currency: found.currency, name };
  }

  /** 파츠·결합형: 선택 단가유형 → 정상판매 fallback. 없으면 거부 */
  private option<T extends OptionLike>(
    line: ParsedQuoteLine,
    lineNo: number,
    option: T,
    kind: string,
  ): T {
    const found =
      (line.priceType ? this.prices.get(key(option.itemCode, line.priceType)) : undefined) ??
      this.prices.get(key(option.itemCode, NORMAL_PRICE_TYPE));
    if (!found) {
      throw new AppError(
        'VALIDATION',
        `${kind} ${option.itemName}(${option.itemCode})의 운영중 단가를 찾을 수 없습니다`,
        { lines: [`라인 ${lineNo}: ${kind} 단가 없음`] },
      );
    }
    if (!sameAmount(found.unitPrice, option.unitPrice)) {
      this.note(
        line,
        lineNo,
        option.itemCode,
        'unitPrice',
        String(option.unitPrice),
        String(found.unitPrice),
      );
    }
    this.note(line, lineNo, option.itemCode, 'name', option.itemName, found.itemName);
    return { ...option, unitPrice: found.unitPrice, itemName: found.itemName };
  }

  /** 그룹 상세 제품: 정상판매 최신 행. 없는 품번은 거부 (PR-8 QA LOW-2 — 파츠·결합형과 같은 규칙) */
  private groupItem<T extends OptionLike>(line: ParsedQuoteLine, lineNo: number, item: T): T {
    const found = this.prices.get(key(item.itemCode, NORMAL_PRICE_TYPE));
    if (!found) {
      throw new AppError(
        'VALIDATION',
        `그룹 상세 ${item.itemName}(${item.itemCode})의 운영중 정상판매 단가를 찾을 수 없습니다`,
        { lines: [`라인 ${lineNo}: 그룹 상세 단가 없음`] },
      );
    }
    if (!sameAmount(found.unitPrice, item.unitPrice)) {
      this.note(
        line,
        lineNo,
        item.itemCode,
        'unitPrice',
        String(item.unitPrice),
        String(found.unitPrice),
      );
    }
    this.note(line, lineNo, item.itemCode, 'name', item.itemName, found.itemName);
    return { ...item, unitPrice: found.unitPrice, itemName: found.itemName };
  }

  line(line: ParsedQuoteLine, index: number): ParsedQuoteLine {
    const lineNo = index + 1;
    return {
      ...line,
      ...this.base(line, lineNo),
      parts: line.parts.map((part) => this.option(line, lineNo, part, '파츠')),
      bundles: line.bundles.map((bundle) => this.option(line, lineNo, bundle, '결합형')),
      groupItems: line.groupItems.map((item) => this.groupItem(line, lineNo, item)),
    };
  }
}

export async function repriceLines(
  db: Db,
  lines: readonly ParsedQuoteLine[],
): Promise<RepriceResult> {
  const { codes, types } = collectCodes(lines);
  const repricer = new Repricer(await loadLatestPrices(db, codes, types));
  const priced = lines.map((line, index) => repricer.line(line, index));
  return { lines: priced, adjustments: repricer.adjustments, families: repricer.families };
}
