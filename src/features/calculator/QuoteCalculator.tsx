'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Pill } from '@/components/ui';
import {
  DraftRestoreBanner,
  type DraftBannerState,
} from '@/features/page-state/DraftRestoreBanner';
import { useDraftSync } from '@/features/page-state/useDraftSync';
import { computeLine, rateFromTarget, roundRate } from '@/lib/pricing/quote';

import {
  deleteQuoteAction,
  listMyQuotesAction,
  listQuoteItemsAction,
  listQuoteOptionsAction,
  saveQuoteAction,
} from './actions';
import { cartDraftOf, linesFromSavedQuote, toLineInput } from './cart';
import { CartPanel } from './CartPanel';
import { Chip } from './chips';
import { groupDraftOf, quoteDraftOf } from './drafts';
import { GroupSolution } from './GroupSolution';
import { StepCategory, StepDiscount, StepItems, StepOptions, StepPriceType } from './QuoteSteps';
import { ShareModal } from './ShareModal';
import type {
  CartDraftRestore,
  CartLineInput,
  CategoryChipsView,
  FamilyPreload,
  GroupDraftRestore,
  GroupSelection,
  PriceAdjustmentView,
  QuoteDraftRestore,
  QuoteFormState,
  QuoteItemView,
  SavedQuoteView,
} from './types';
import { useCart } from './useCart';

type QuoteCalculatorProps = {
  /** 현재 사용자 id — 내 견적 목록 표의 열 설정 저장 키 (#32) */
  userId: string;
  preload: readonly FamilyPreload[];
  savedQuotes: readonly SavedQuoteView[];
  /** 챗봇 견적 시작 링크(§4.5.9): 제품군을 먼저 고르고 품번이 목록에 있으면 선택해 둔다 */
  initial?: { family?: string; itemCode?: string };
  /** RSC 가 읽은 입력 초안 (page-state-memory §2.4-3) — 첫 진입에만. 복원 배너를 띄운다 */
  restored?: QuoteRestoredDrafts;
  /** 같은 화면 안 탭 전환으로 다시 마운트될 때의 마지막 상태 (배너 없음) */
  resume?: QuoteSnapshot;
  /** 현재 상태 보고 (탭 전환 뒤 resume 으로 돌려받는다) */
  onSnapshot?: (snapshot: QuoteSnapshot) => void;
};

export type QuoteRestoredDrafts = {
  quote?: QuoteDraftRestore;
  cart?: CartDraftRestore;
  group?: GroupDraftRestore;
};

export type QuoteSnapshot = {
  quote: QuoteFormState;
  cart: CartLineInput[];
  group: GroupSelection | null;
};

type Flash = { tone: 'ok' | 'error'; text: string };
type Options = { parts: QuoteItemView[]; bundles: QuoteItemView[]; mapped: boolean };
type Loaded<T> = { key: string; data: T };

const NO_OPTIONS: Options = { parts: [], bundles: [], mapped: false };
const EMPTY_CHIPS: CategoryChipsView = { majors: [], mids: [], minorsByMid: {}, hasMaster: false };

function asOption(item: QuoteItemView) {
  return { itemCode: item.itemCode, itemName: item.itemName, unitPrice: Number(item.unitPrice) };
}

/** 복원 배너 = 견적 입력·그룹 솔루션 초안 중 복원된 것 (시각은 더 최근 것, 안내는 합침) */
function mergeBanner(
  ...entries: readonly ({ updatedAt: string; restoredAt: string; notices: string[] } | undefined)[]
): DraftBannerState | null {
  const found = entries.filter((entry) => entry !== undefined);
  if (found.length === 0) return null;
  const latest = found.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
  return { restoredAt: latest.restoredAt, notices: found.flatMap((entry) => entry.notices) };
}

function toggle(set: ReadonlySet<string>, code: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(code);
  else next.delete(code);
  return next;
}

/**
 * 견적 계산기 (§4.5.7): 제품 → 그룹 솔루션 → STEP1 단가유형 → STEP2 분류 → STEP3 품목·수량 → STEP4 파츠 → STEP5 결합형
 * → STEP6 할인율/목표금액 → 장바구니 → 견적 저장/목록/담기/삭제. 금액은 lib/pricing/quote.ts 순수 함수.
 * 서버 조회 결과는 "요청 키" 와 함께 보관해 선택이 바뀌면 이전 결과를 보여 주지 않는다 (effect 안에서 동기 setState 없음).
 */
export function QuoteCalculator({
  userId,
  preload,
  savedQuotes,
  initial,
  restored,
  resume,
  onSnapshot,
}: QuoteCalculatorProps) {
  const defaultFamily = preload[0]?.family ?? '';
  const defaultPriceTypeOf = (name: string) =>
    preload.find((entry) => entry.family === name)?.priceTypes[0]?.priceType ?? null;
  // 첫 상태: 탭 전환 복귀 > 입력 초안 복원 > 챗봇 링크 > 기본 (page-state-memory §2.4-3)
  const [start] = useState<QuoteFormState>(() => {
    const saved = resume?.quote ?? restored?.quote?.form;
    if (saved) return saved;
    const family =
      initial?.family && preload.some((entry) => entry.family === initial.family)
        ? initial.family
        : defaultFamily;
    return {
      family,
      priceType: defaultPriceTypeOf(family),
      mid: null,
      minor: null,
      selected: null,
      qty: 1,
      parts: [],
      bundles: [],
      rate: 0,
      target: '',
    };
  });
  const [family, setFamily] = useState(start.family);
  const [pendingItem, setPendingItem] = useState<string | null>(
    resume || restored?.quote ? null : (initial?.itemCode ?? null),
  );
  const current = preload.find((entry) => entry.family === family) ?? null;
  const [priceType, setPriceType] = useState<string | null>(start.priceType);
  const [mid, setMid] = useState<string | null>(start.mid);
  const [minor, setMinor] = useState<string | null>(start.minor);
  const [selected, setSelected] = useState<QuoteItemView | null>(start.selected);
  const [qty, setQty] = useState(start.qty);
  const [loadedItems, setLoadedItems] = useState<Loaded<QuoteItemView[]> | null>(null);
  const [loadedOptions, setLoadedOptions] = useState<Loaded<Options> | null>(null);
  const [parts, setParts] = useState<ReadonlySet<string>>(() => new Set(start.parts));
  const [bundles, setBundles] = useState<ReadonlySet<string>>(() => new Set(start.bundles));
  const [rate, setRate] = useState(start.rate);
  const [target, setTarget] = useState(start.target);
  const [cart, dispatch] = useCart(resume?.cart ?? restored?.cart?.lines);
  const [group, setGroup] = useState<GroupSelection | null>(
    resume ? resume.group : (restored?.group?.selection ?? null),
  );
  // 복원 배너 (탭 전환 복귀에는 없음) — 견적 입력·그룹 솔루션 / 장바구니
  const [quoteBanner, setQuoteBanner] = useState<DraftBannerState | null>(() =>
    resume ? null : mergeBanner(restored?.quote, restored?.group),
  );
  const [cartBanner, setCartBanner] = useState<DraftBannerState | null>(() =>
    !resume && restored?.cart
      ? { restoredAt: restored.cart.restoredAt, notices: restored.cart.notices }
      : null,
  );
  const [saved, setSaved] = useState<readonly SavedQuoteView[]>(savedQuotes);
  const [activeQuote, setActiveQuote] = useState<SavedQuoteView | null>(null);
  const [sharing, setSharing] = useState<SavedQuoteView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [isPending, startTransition] = useTransition();

  const itemsKey = priceType ? `${family}|${priceType}|${mid ?? ''}|${minor ?? ''}` : '';
  const optionsKey = selected && priceType ? `${family}|${priceType}|${selected.itemCode}` : '';
  const items = loadedItems?.key === itemsKey ? loadedItems.data : [];
  const loadingItems = itemsKey !== '' && loadedItems?.key !== itemsKey;
  const options = loadedOptions?.key === optionsKey ? loadedOptions.data : NO_OPTIONS;

  useEffect(() => {
    if (!itemsKey || !priceType) return;
    let active = true;
    void listQuoteItemsAction({
      family,
      priceType,
      mid: mid ?? undefined,
      minor: minor ?? undefined,
    }).then((result) => {
      if (!active) return;
      setLoadedItems({ key: itemsKey, data: result.ok ? result.data : [] });
      if (!result.ok) setFlash({ tone: 'error', text: result.error.message });
      // 챗봇 링크로 넘어온 품번이 목록에 있으면 한 번만 선택해 둔다
      if (pendingItem && result.ok) {
        const found = result.data.find((item) => item.itemCode === pendingItem);
        if (found) {
          setSelected(found);
          setFlash({ tone: 'ok', text: `챗봇에서 넘어온 품목을 선택했습니다: ${found.itemName}` });
        } else {
          setFlash({
            tone: 'error',
            text: `챗봇에서 넘어온 품번(${pendingItem})을 ${family} · ${priceType} 목록에서 찾지 못했습니다. 품목을 직접 선택하세요.`,
          });
        }
        setPendingItem(null);
      }
    });
    return () => {
      active = false;
    };
  }, [itemsKey, family, priceType, mid, minor, pendingItem]);

  useEffect(() => {
    if (!optionsKey || !selected || !priceType) return;
    let active = true;
    void listQuoteOptionsAction({ family, priceType, modelItemCode: selected.itemCode }).then(
      (result) => {
        if (!active) return;
        setLoadedOptions({ key: optionsKey, data: result.ok ? result.data : NO_OPTIONS });
      },
    );
    return () => {
      active = false;
    };
  }, [optionsKey, family, priceType, selected]);

  const resetSelection = () => {
    setSelected(null);
    setParts(new Set());
    setBundles(new Set());
  };
  const chooseFamily = (next: string) => {
    const entry = preload.find((candidate) => candidate.family === next);
    setFamily(next);
    setPriceType(entry?.priceTypes[0]?.priceType ?? null);
    setMid(null);
    setMinor(null);
    resetSelection();
  };
  const choosePriceType = (next: string) => {
    setPriceType(next);
    resetSelection();
  };
  // 품목을 바꾸면 이전 품목 기준의 수량·할인율·목표금액을 버린다 (PR-7 QA LOW)
  const selectItem = (item: QuoteItemView) => {
    setSelected(item);
    setParts(new Set());
    setBundles(new Set());
    setQty(1);
    setRate(0);
    setTarget('');
  };

  // ── 입력 초안 저장 (page-state-memory §2.4) ─────────────────────────────
  const form: QuoteFormState = useMemo(
    () => ({
      family,
      priceType,
      mid,
      minor,
      selected,
      qty,
      parts: [...parts],
      bundles: [...bundles],
      rate,
      target,
    }),
    [family, priceType, mid, minor, selected, qty, parts, bundles, rate, target],
  );
  const quoteDefaults = { family: defaultFamily, priceType: defaultPriceTypeOf(defaultFamily) };
  const toQuoteDraft = (next: QuoteFormState) => quoteDraftOf(next, quoteDefaults);
  const applyForm = (next: QuoteFormState) => {
    setFamily(next.family);
    setPriceType(next.priceType);
    setMid(next.mid);
    setMinor(next.minor);
    setSelected(next.selected);
    setQty(next.qty);
    setParts(new Set(next.parts));
    setBundles(new Set(next.bundles));
    setRate(next.rate);
    setTarget(next.target);
  };
  const startDraft = toQuoteDraft(start);
  const quoteSync = useDraftSync({
    draftKey: 'quote',
    value: toQuoteDraft(form),
    hasServerDraft: Boolean(restored?.quote) || (resume !== undefined && startDraft !== null),
    persistInitial: !resume && Boolean(restored?.quote?.dirty),
    toValue: (next) => toQuoteDraft(next.form),
    onRemote: (next) => applyForm(next.form),
  });
  const cartSync = useDraftSync({
    draftKey: 'cart',
    value: cartDraftOf(cart.lines),
    hasServerDraft: Boolean(restored?.cart) || (resume?.cart.length ?? 0) > 0,
    persistInitial: !resume && Boolean(restored?.cart?.dirty),
    toValue: (next) => (next.lines.length > 0 ? { lines: next.lines } : null),
    onRemote: (next) => dispatch({ type: 'restore', lines: next.lines }),
  });
  const groupSync = useDraftSync({
    draftKey: 'group-solution',
    value: groupDraftOf(group),
    hasServerDraft: Boolean(restored?.group) || groupDraftOf(resume?.group ?? null) !== null,
    persistInitial: !resume && Boolean(restored?.group?.dirty),
    toValue: (next) => groupDraftOf(next.selection),
    onRemote: (next) => setGroup(next.selection),
  });

  useEffect(() => {
    onSnapshot?.({ quote: form, cart: cart.lines.map(toLineInput), group });
  }, [onSnapshot, form, cart.lines, group]);

  /** '새로 시작' (견적 입력·그룹 솔루션): 초안 삭제 + 기본 상태 (§2.6-2) */
  const startOver = () => {
    quoteSync.discard();
    groupSync.discard();
    chooseFamily(defaultFamily);
    setQty(1);
    setRate(0);
    setTarget('');
    setGroup(null);
    setPendingItem(null);
    setQuoteBanner(null);
  };
  /** '견적 초기화'·장바구니 '새로 시작': 장바구니 초안 삭제 (§2.6-2) */
  const resetCart = () => {
    cartSync.discard();
    dispatch({ type: 'reset' });
    setCartBanner(null);
  };

  const pricedParts = options.parts.filter((part) => parts.has(part.itemCode)).map(asOption);
  const pricedBundles = options.bundles
    .filter((bundle) => bundles.has(bundle.itemCode))
    .map(asOption);
  const amounts = computeLine({
    basePrice: selected ? Number(selected.unitPrice) : 0,
    parts: pricedParts,
    bundles: pricedBundles,
    qty,
    discountRate: rate,
  });
  const currency = selected?.currency ?? 'KRW';

  const onRate = (next: number) => {
    setRate(roundRate(next));
    setTarget('');
  };
  const onTarget = (next: string) => {
    setTarget(next);
    if (next !== '') setRate(rateFromTarget(Number(next), amounts.preDiscount));
  };

  const addItem = () => {
    if (!selected || !priceType) return;
    dispatch({
      type: 'add',
      line: {
        kind: 'item',
        itemCode: selected.itemCode,
        name: selected.itemName,
        priceType,
        qty,
        unitPrice: Number(selected.unitPrice),
        currency,
        parts: pricedParts,
        bundles: pricedBundles,
        groupItems: [],
        discountRate: rate,
      },
    });
    setFlash({ tone: 'ok', text: `장바구니에 담았습니다: ${selected.itemName} × ${qty}` });
  };

  const refreshSaved = useCallback(async (): Promise<readonly SavedQuoteView[]> => {
    const result = await listMyQuotesAction();
    if (result.ok) setSaved(result.data);
    return result.ok ? result.data : [];
  }, []);

  const save = () =>
    startTransition(async () => {
      const result = await saveQuoteAction({
        productFamily: family,
        lines: cart.lines.map(toLineInput),
      });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setFlash({
        tone: 'ok',
        text: `견적을 저장했습니다: ${result.data.quoteNo}${adjustmentNote(result.data.adjustments)}`,
      });
      dispatch({ type: 'reset' });
      const list = await refreshSaved();
      setActiveQuote(list.find((quote) => quote.id === result.data.id) ?? null);
    });

  const reload = (quote: SavedQuoteView) => {
    dispatch({ type: 'restore', lines: linesFromSavedQuote(quote) });
    setActiveQuote(quote);
    if (quote.productFamily && preload.some((entry) => entry.family === quote.productFamily)) {
      chooseFamily(quote.productFamily);
    }
    setFlash({ tone: 'ok', text: `${quote.quoteNo} 을(를) 장바구니에 담았습니다` });
  };

  const remove = (quote: SavedQuoteView) =>
    startTransition(async () => {
      const result = await deleteQuoteAction({ id: quote.id });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setFlash({ tone: 'ok', text: `견적을 삭제했습니다: ${quote.quoteNo}` });
      setActiveQuote((current) => (current?.id === quote.id ? null : current));
      await refreshSaved();
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Pill tone="neutral">가견적 산출용 · 계약가 아님</Pill>
        <p className="m-0 text-[13px] text-text-tertiary">
          제품과 옵션을 선택해 장바구니에 담으면, 여러 품목을 함께 견적으로 계산할 수 있습니다.
        </p>
      </div>
      <DraftRestoreBanner banner={quoteBanner} label="견적 입력 복원 안내" onReset={startOver} />
      <Presence>
        {flash ? (
          <Collapse key="flash" role={flash.tone === 'error' ? 'alert' : 'status'}>
            <p
              className={
                flash.tone === 'error'
                  ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-600'
                  : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700'
              }
            >
              {flash.text}
            </p>
          </Collapse>
        ) : null}
      </Presence>
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <section
            aria-label="제품"
            className="rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
          >
            <h2 className="m-0 mb-3.5 text-[13px] font-semibold text-text-tertiary">제품</h2>
            <div
              className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
              role="group"
              aria-label="제품군"
            >
              {preload.map((entry) => (
                <Chip
                  key={entry.family}
                  active={entry.family === family}
                  onClick={() => chooseFamily(entry.family)}
                >
                  {entry.family}
                </Chip>
              ))}
            </div>
          </section>
          {current ? (
            <GroupSolution
              family={family}
              groups={current.groups}
              hardware={current.hardware}
              selection={group}
              onSelection={setGroup}
              onAdd={(line) => {
                dispatch({ type: 'add', line });
                setFlash({ tone: 'ok', text: `그룹을 장바구니에 담았습니다: ${line.name}` });
              }}
            />
          ) : null}
          <StepPriceType
            options={current?.priceTypes ?? []}
            value={priceType}
            onChange={choosePriceType}
          />
          <StepCategory
            chips={current?.categories ?? { ...EMPTY_CHIPS, majors: [family] }}
            mid={mid}
            minor={minor}
            onMid={(next) => {
              setMid(next);
              setMinor(null);
              resetSelection();
            }}
            onMinor={(next) => {
              setMinor(next);
              resetSelection();
            }}
          />
          <StepItems
            items={items}
            loading={loadingItems}
            selected={selected}
            qty={qty}
            onSelect={selectItem}
            onQty={setQty}
          />
          <StepOptions
            title="STEP 4 · 파츠"
            note={
              selected
                ? options.mapped
                  ? '이 모델에 등록된 장착 가능 파츠만 표시합니다.'
                  : '등록된 매핑이 없어 같은 제품군의 파츠 전체를 표시합니다.'
                : undefined
            }
            emptyText="없음 (해당 대분류에 파츠가 없습니다)"
            options={options.parts}
            checked={parts}
            onToggle={(code, on) => setParts((set) => toggle(set, code, on))}
          />
          <StepOptions
            title="STEP 5 · 결합형"
            emptyText="없음 (해당 대분류에 결합형이 없습니다)"
            options={options.bundles}
            checked={bundles}
            onToggle={(code, on) => setBundles((set) => toggle(set, code, on))}
          />
          <StepDiscount
            preDiscount={amounts.preDiscount}
            lineTotal={amounts.lineTotal}
            currency={currency}
            rate={rate}
            target={target}
            onRate={onRate}
            onTarget={onTarget}
          />
          <button
            type="button"
            disabled={!selected}
            onClick={addItem}
            className="rounded-lg border-0 bg-lime-400 px-4 py-3.5 text-[13px] font-semibold text-ink-900 disabled:opacity-50"
          >
            + 장바구니에 담기 ({selected ? `${selected.itemName} × ${qty}` : '품목을 선택하세요'})
          </button>
        </div>
        <CartPanel
          userId={userId}
          lines={cart.lines}
          saved={saved}
          isPending={isPending}
          onRemove={(id) => dispatch({ type: 'remove', id })}
          onReset={resetCart}
          banner={
            <DraftRestoreBanner
              banner={cartBanner}
              label="장바구니 복원 안내"
              onReset={resetCart}
            />
          }
          onSave={save}
          onReload={reload}
          onDelete={remove}
          activeQuote={activeQuote}
          onShare={setSharing}
        />
      </div>
      <Presence>
        {sharing ? <ShareModal quote={sharing} onClose={() => setSharing(null)} /> : null}
      </Presence>
    </div>
  );
}

/** 서버 재가격화 보정이 있으면 저장 안내에 덧붙인다 (담기로 복원한 옛 스냅샷 등) */
export function adjustmentNote(adjustments: readonly PriceAdjustmentView[]): string {
  if (adjustments.length === 0) return '';
  const first = adjustments[0]!;
  const label = { unitPrice: '단가', currency: '통화', name: '품명' }[first.field];
  const detail = `${first.name} ${label} ${first.client} → ${first.server}`;
  const rest = adjustments.length > 1 ? ` 외 ${adjustments.length - 1}건` : '';
  return ` · 최신 정책으로 보정됨: ${detail}${rest}`;
}
