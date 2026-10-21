import 'server-only';

import type { Db } from '@/db';
import type {
  CalculatorDrafts,
  CartDraftRestore,
  CartLineInput,
  DraftRestoreMap,
  FamilyPreload,
  GroupDraftRestore,
  MarginDraftRestore,
  QuoteDraftRestore,
  QuoteFormState,
} from '@/features/calculator/types';
import {
  formatRestoredAt,
  repriceNotices,
  type CartDraft,
  type DraftKey,
  type GroupSolutionDraft,
  type QuoteDraft,
} from '@/lib/page-state/drafts';
import { listGroupChips } from '@/server/groups/queries';
import { listProductFamilies } from '@/server/parts/catalog';
import {
  listGroupHardware,
  listQuoteBundles,
  listQuoteCategories,
  listQuoteItems,
  listQuoteParts,
  listQuotePriceTypes,
} from '@/server/quotes/catalog';
import { repriceDryRun } from '@/server/quotes/reprice';
import { quoteLineSchema } from '@/server/quotes/schemas';

import { readDraft } from './drafts';

/**
 * 입력 초안 복원 (page-state-memory §2.4-3·§2.5·§2.6-1) — 저장된 초안을 화면 초기 props 로 바꾼다.
 * 계산기 RSC(초기 렌더, 하이드레이션 안전)와 초안 다시 읽기 액션(탭이 다시 보일 때) 이 같은 함수를 쓴다.
 * - quote: 제품군 → 단가유형 → 분류 → 품목 순서로 **다시 조회**하며 복원하고, 없어진 값이 나오면 그 단계에서 멈추고 안내한다.
 *   품목은 최신 행으로 선택하며 선택 시점 단가와 다르면 "최신가로 갱신" 안내, 없어진 파츠·결합형은 빼고 "판매하지 않아 제외" 안내.
 * - cart: 견적 저장과 같은 규칙의 재가격화 dry-run → 최신가로 갱신 + 판매 중지·삭제 품목 라인 제외(§2.5).
 * - group-solution: 같은 제품군의 그룹·하드웨어·상세 제품을 다시 조회해 없어진 값은 뺀다.
 * - margin: 원가 입력은 초안에 애초에 없다(§2.1-3).
 */
type Meta = { updatedAt: Date };

function meta(stored: Meta, notices: string[], dirty: boolean) {
  return {
    updatedAt: stored.updatedAt.toISOString(),
    restoredAt: formatRestoredAt(stored.updatedAt),
    notices,
    dirty,
  };
}

const samePrice = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** 페이지가 이미 조회한 제품군별 STEP1·STEP2·그룹 데이터 (없으면 DB 에서 조회) */
type Catalog = { preload?: readonly FamilyPreload[] };

async function familyData(db: Db, family: string, { preload }: Catalog) {
  const found = preload?.find((entry) => entry.family === family);
  if (found) return found;
  if (preload) return null;
  if (!(await listProductFamilies(db)).includes(family)) return null;
  const [priceTypes, categories, groups, hardware] = await Promise.all([
    listQuotePriceTypes(db, family),
    listQuoteCategories(db, family),
    listGroupChips(db, family),
    listGroupHardware(db, family),
  ]);
  return { family, priceTypes, categories, groups, hardware };
}

/** 견적 계산기 기본 상태 (제품군 첫 단가유형, 품목 없음) */
export function defaultQuoteForm(family: string, firstPriceType: string | null): QuoteFormState {
  return {
    family,
    priceType: firstPriceType,
    mid: null,
    minor: null,
    selected: null,
    qty: 1,
    parts: [],
    bundles: [],
    rate: 0,
    target: '',
  };
}

/** 견적 선택값 단계별 복원 (제품군 → 단가유형 → 분류 → 품목 → 파츠·결합형) */
export async function resolveQuoteDraft(
  db: Db,
  draft: QuoteDraft,
  catalog: Catalog = {},
): Promise<{ form: QuoteFormState; notices: string[]; dirty: boolean } | null> {
  const family = await familyData(db, draft.family, catalog);
  if (!family) return null;
  const firstPriceType = family.priceTypes[0]?.priceType ?? null;
  const form = defaultQuoteForm(family.family, firstPriceType);
  const stop = (notice: string) => ({ form, notices: [notice], dirty: true });

  if (draft.priceType !== null) {
    if (!family.priceTypes.some((entry) => entry.priceType === draft.priceType)) {
      return stop(
        `저장된 단가 유형(${draft.priceType})을 찾을 수 없어 제품군 단계까지만 복원했습니다`,
      );
    }
    form.priceType = draft.priceType;
  }

  const { categories } = family;
  if (draft.mid !== null) {
    const minors = Object.hasOwn(categories.minorsByMid, draft.mid)
      ? categories.minorsByMid[draft.mid]!
      : [];
    const valid =
      categories.hasMaster &&
      categories.mids.includes(draft.mid) &&
      (draft.minor === null || minors.includes(draft.minor));
    if (!valid) {
      const name = draft.minor ? `${draft.mid} > ${draft.minor}` : draft.mid;
      return stop(`저장된 분류(${name})를 찾을 수 없어 단가 유형 단계까지만 복원했습니다`);
    }
    form.mid = draft.mid;
    form.minor = draft.minor;
  }

  if (draft.itemCode === null || form.priceType === null) {
    return { form, notices: [], dirty: draft.itemCode !== null };
  }
  const filter = {
    family: form.family,
    priceType: form.priceType,
    mid: form.mid ?? undefined,
    minor: form.minor ?? undefined,
  };
  const candidates = await listQuoteItems(db, filter);
  const selected = candidates.find((item) => item.itemCode === draft.itemCode);
  if (!selected) {
    return stop(`저장된 품목(${draft.itemCode})을 찾을 수 없어 분류 단계까지만 복원했습니다`);
  }

  const [parts, bundles] = await Promise.all([
    listQuoteParts(db, { ...filter, modelItemCode: selected.itemCode }),
    listQuoteBundles(db, filter),
  ]);
  const partCodes = new Set(parts.parts.map((part) => part.itemCode));
  const bundleCodes = new Set(bundles.map((bundle) => bundle.itemCode));
  const keptParts = draft.parts.filter((itemCode) => partCodes.has(itemCode));
  const keptBundles = draft.bundles.filter((itemCode) => bundleCodes.has(itemCode));
  const removed =
    draft.parts.length - keptParts.length + (draft.bundles.length - keptBundles.length);
  const changed =
    draft.unitPrice !== null && !samePrice(Number(selected.unitPrice), draft.unitPrice) ? 1 : 0;

  Object.assign(form, {
    selected,
    qty: draft.qty,
    parts: keptParts,
    bundles: keptBundles,
    rate: draft.rate,
    // 단가가 바뀌면 목표 금액(역산 기준)은 맞지 않는다 — 할인율만 유지
    target: changed ? '' : draft.target,
  });
  return { form, notices: repriceNotices(changed, removed), dirty: changed + removed > 0 };
}

/** 장바구니 최신가 갱신 (재가격화 dry-run) */
export async function resolveCartDraft(
  db: Db,
  draft: CartDraft,
): Promise<{ lines: CartLineInput[]; notices: string[]; dirty: boolean }> {
  const parsed = draft.lines.map((line) => quoteLineSchema.safeParse(line));
  const valid = parsed.flatMap((result) => (result.success ? [result.data] : []));
  const result = await repriceDryRun(db, valid);
  const removed = result.removed + (parsed.length - valid.length);
  const lines: CartLineInput[] = result.lines.map((line) => ({
    kind: line.kind,
    itemCode: line.itemCode,
    groupId: line.groupId,
    name: line.name,
    priceType: line.priceType,
    qty: line.qty,
    unitPrice: line.unitPrice,
    currency: line.currency,
    parts: line.parts,
    bundles: line.bundles,
    groupItems: line.groupItems,
    discountRate: line.discountRate,
  }));
  return {
    lines,
    notices: repriceNotices(result.changed, removed),
    dirty: result.changed + removed > 0,
  };
}

/** 그룹 솔루션 선택 복원 — 그룹이 없어졌으면 null(복원하지 않음) */
export async function resolveGroupDraft(
  db: Db,
  draft: GroupSolutionDraft,
  catalog: Catalog = {},
): Promise<Omit<GroupDraftRestore, 'updatedAt' | 'restoredAt'> | null> {
  const family = await familyData(db, draft.family, catalog);
  const group = family?.groups.find((entry) => entry.id === draft.groupId);
  if (!family || !group) return null;
  const hardwareCode = family.hardware.some((entry) => entry.itemCode === draft.hardwareCode)
    ? draft.hardwareCode
    : '';
  const saved = new Map(draft.items.map((item) => [item.itemCode, item]));
  const items = Object.fromEntries(
    group.items.map((item) => {
      const entry = saved.get(item.itemCode);
      return [
        item.itemCode,
        entry ? { checked: entry.checked, qty: entry.qty } : { checked: false, qty: 1 },
      ];
    }),
  );
  const dropped =
    draft.items.filter((item) => !group.items.some((entry) => entry.itemCode === item.itemCode))
      .length + (hardwareCode !== draft.hardwareCode ? 1 : 0);
  return {
    selection: { family: family.family, groupId: group.id, hardwareCode, items },
    notices: dropped > 0 ? [`${dropped}건은 더 이상 판매하지 않아 제외했습니다`] : [],
    dirty: dropped > 0,
  };
}

/** 초안 키 하나를 읽어 복원 형태로 (없음·만료·폐기·복원 불가면 null) */
export async function restoreDraft<K extends DraftKey>(
  db: Db,
  userId: string,
  draftKey: K,
  catalog: Catalog = {},
): Promise<DraftRestoreMap[K] | null> {
  // 키마다 반환 형태가 달라 분기별로 좁힌 뒤 맵 타입으로 돌려준다
  return (await restoreAny(db, userId, draftKey, catalog)) as DraftRestoreMap[K] | null;
}

async function restoreAny(
  db: Db,
  userId: string,
  draftKey: DraftKey,
  catalog: Catalog,
): Promise<DraftRestoreMap[DraftKey] | null> {
  switch (draftKey) {
    case 'quote': {
      const stored = await readDraft(db, userId, 'quote');
      if (!stored) return null;
      const resolved = await resolveQuoteDraft(db, stored.data, catalog);
      if (!resolved) {
        // 제품군이 없어졌다 — 첫 단계에서 멈춤. 화면 기본 제품군을 알 때(페이지 진입)만 안내와 함께 기본 상태로
        const first = catalog.preload?.[0];
        if (!first) return null;
        return {
          ...meta(
            stored,
            [`저장된 제품군(${stored.data.family})을 찾을 수 없어 견적 입력을 복원하지 못했습니다`],
            true,
          ),
          form: defaultQuoteForm(first.family, first.priceTypes[0]?.priceType ?? null),
        } satisfies QuoteDraftRestore;
      }
      return {
        ...meta(stored, resolved.notices, resolved.dirty),
        form: resolved.form,
      } satisfies QuoteDraftRestore;
    }
    case 'cart': {
      const stored = await readDraft(db, userId, 'cart');
      if (!stored) return null;
      const resolved = await resolveCartDraft(db, stored.data);
      return {
        ...meta(stored, resolved.notices, resolved.dirty),
        lines: resolved.lines,
      } satisfies CartDraftRestore;
    }
    case 'margin': {
      const stored = await readDraft(db, userId, 'margin');
      if (!stored) return null;
      const { sellingPrice, quantity, discountRate } = stored.data;
      return {
        ...meta(stored, [], false),
        values: { sellingPrice, quantity, discountRate },
      } satisfies MarginDraftRestore;
    }
    case 'group-solution': {
      const stored = await readDraft(db, userId, 'group-solution');
      if (!stored) return null;
      const resolved = await resolveGroupDraft(db, stored.data, catalog);
      if (!resolved) return null;
      return {
        ...meta(stored, resolved.notices, resolved.dirty),
        selection: resolved.selection,
      } satisfies GroupDraftRestore;
    }
  }
}

/**
 * 계산기 RSC 진입 시 초안 4종 복원. user 는 세션 사용자만 넘긴다(§2.7-2).
 * `skipQuote`: 챗봇 "견적 시작" 링크(?family=&item=)로 들어온 진입 — 링크 선택이 초안보다 우선한다.
 */
export async function restoreCalculatorDrafts(
  db: Db,
  userId: string,
  { preload, skipQuote = false }: { preload: readonly FamilyPreload[]; skipQuote?: boolean },
): Promise<CalculatorDrafts> {
  const catalog = { preload };
  const [quote, cart, margin, groupSolution] = await Promise.all([
    skipQuote ? null : restoreDraft(db, userId, 'quote', catalog),
    restoreDraft(db, userId, 'cart', catalog),
    restoreDraft(db, userId, 'margin', catalog),
    skipQuote ? null : restoreDraft(db, userId, 'group-solution', catalog),
  ]);
  const drafts: CalculatorDrafts = {};
  if (quote) drafts.quote = quote;
  if (cart) drafts.cart = cart;
  if (margin) drafts.margin = margin;
  if (groupSolution) drafts['group-solution'] = groupSolution;
  return drafts;
}
