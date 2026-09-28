'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { Pill } from '@/components/ui';
import { computeLine, rateFromTarget, roundRate } from '@/lib/pricing/quote';

import {
  deleteQuoteAction,
  listMyQuotesAction,
  listQuoteItemsAction,
  listQuoteOptionsAction,
  saveQuoteAction,
} from './actions';
import { linesFromSavedQuote } from './cart';
import { CartPanel } from './CartPanel';
import { Chip } from './chips';
import { GroupSolution } from './GroupSolution';
import { StepCategory, StepDiscount, StepItems, StepOptions, StepPriceType } from './QuoteSteps';
import { ShareModal } from './ShareModal';
import type {
  CartLine,
  FamilyPreload,
  PriceAdjustmentView,
  QuoteItemView,
  SavedQuoteView,
} from './types';
import { useCart } from './useCart';

type QuoteCalculatorProps = {
  preload: readonly FamilyPreload[];
  savedQuotes: readonly SavedQuoteView[];
};

type Flash = { tone: 'ok' | 'error'; text: string };
type Options = { parts: QuoteItemView[]; bundles: QuoteItemView[]; mapped: boolean };
type Loaded<T> = { key: string; data: T };

const NO_OPTIONS: Options = { parts: [], bundles: [], mapped: false };
const EMPTY_CHIPS = {
  majors: [] as string[],
  mids: [] as string[],
  minors: [] as string[],
  hasMaster: false,
};

function toLineInput(line: CartLine) {
  return {
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
  };
}

function asOption(item: QuoteItemView) {
  return { itemCode: item.itemCode, itemName: item.itemName, unitPrice: Number(item.unitPrice) };
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
export function QuoteCalculator({ preload, savedQuotes }: QuoteCalculatorProps) {
  const [family, setFamily] = useState(preload[0]?.family ?? '');
  const current = preload.find((entry) => entry.family === family) ?? null;
  const [priceType, setPriceType] = useState<string | null>(
    current?.priceTypes[0]?.priceType ?? null,
  );
  const [mid, setMid] = useState<string | null>(null);
  const [minor, setMinor] = useState<string | null>(null);
  const [selected, setSelected] = useState<QuoteItemView | null>(null);
  const [qty, setQty] = useState(1);
  const [loadedItems, setLoadedItems] = useState<Loaded<QuoteItemView[]> | null>(null);
  const [loadedOptions, setLoadedOptions] = useState<Loaded<Options> | null>(null);
  const [parts, setParts] = useState<ReadonlySet<string>>(new Set());
  const [bundles, setBundles] = useState<ReadonlySet<string>>(new Set());
  const [rate, setRate] = useState(0);
  const [target, setTarget] = useState('');
  const [cart, dispatch] = useCart();
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
    });
    return () => {
      active = false;
    };
  }, [itemsKey, family, priceType, mid, minor]);

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
      {flash ? (
        <p
          role={flash.tone === 'error' ? 'alert' : 'status'}
          className={
            flash.tone === 'error'
              ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-500'
              : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-600'
          }
        >
          {flash.text}
        </p>
      ) : null}
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
              groups={current.groups}
              hardware={current.hardware}
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
          lines={cart.lines}
          saved={saved}
          isPending={isPending}
          onRemove={(id) => dispatch({ type: 'remove', id })}
          onReset={() => dispatch({ type: 'reset' })}
          onSave={save}
          onReload={reload}
          onDelete={remove}
          activeQuote={activeQuote}
          onShare={setSharing}
        />
      </div>
      {sharing ? <ShareModal quote={sharing} onClose={() => setSharing(null)} /> : null}
    </div>
  );
}

/** 서버 재가격화 보정이 있으면 저장 안내에 덧붙인다 (담기로 복원한 옛 스냅샷 등) */
export function adjustmentNote(adjustments: readonly PriceAdjustmentView[]): string {
  if (adjustments.length === 0) return '';
  const first = adjustments[0]!;
  const detail =
    first.field === 'unitPrice'
      ? `${first.name} 단가 ${first.client} → ${first.server}`
      : `${first.name} 통화 ${first.client} → ${first.server}`;
  const rest = adjustments.length > 1 ? ` 외 ${adjustments.length - 1}건` : '';
  return ` · 최신 정책으로 보정됨: ${detail}${rest}`;
}
