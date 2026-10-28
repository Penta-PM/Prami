'use client';

import { m, useIsPresent } from 'motion/react';
import type { ReactNode } from 'react';

import { Presence } from '@/components/motion/Presence';
import { Checkbox, Input } from '@/components/ui';
import { VARIANT_KEYS, scaleIn, transition } from '@/lib/motion/tokens';
import { formatAmount, priceLabel } from '@/lib/pricing/format';
import { rateFromTarget } from '@/lib/pricing/quote';

import { Chip, QtyControl, StepCard } from './chips';
import type { CategoryChipsView, PriceTypeView, QuoteItemView } from './types';

/** STEP 1 · 단가 유형 = DB DISTINCT price_type (배수 없음, AC-61) */
export function StepPriceType({
  options,
  value,
  onChange,
}: {
  options: readonly PriceTypeView[];
  value: string | null;
  onChange: (priceType: string) => void;
}) {
  return (
    <StepCard title="STEP 1 · 단가 유형">
      {options.length === 0 ? (
        <p className="m-0 text-[12px] text-text-tertiary">운영중 판매단가가 없는 제품군입니다.</p>
      ) : (
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
          role="group"
          aria-label="단가 유형"
        >
          {options.map((option) => (
            <Chip
              key={option.priceType}
              active={value === option.priceType}
              hint={`${option.count}건`}
              onClick={() => onChange(option.priceType)}
            >
              {option.priceType}
            </Chip>
          ))}
        </div>
      )}
    </StepCard>
  );
}

/** STEP 2 · 대/중/소분류. 마스터가 없으면 대분류(제품군)만 */
export function StepCategory({
  chips,
  mid,
  minor,
  onMid,
  onMinor,
}: {
  chips: CategoryChipsView;
  mid: string | null;
  minor: string | null;
  onMid: (mid: string | null) => void;
  onMinor: (minor: string | null) => void;
}) {
  // 소분류 = 선택한 중분류의 사전 적재분 (프로토타입 키 방지로 own 속성만)
  const minors = mid && Object.hasOwn(chips.minorsByMid, mid) ? chips.minorsByMid[mid]! : [];
  return (
    <StepCard title="STEP 2 · 대분류 / 중분류 / 소분류">
      <div className="flex flex-col gap-3">
        <ChipRow label="대분류">
          {chips.majors.map((major) => (
            <Chip key={major} active onClick={() => undefined}>
              {major}
            </Chip>
          ))}
        </ChipRow>
        {chips.hasMaster ? (
          <ChipRow label="중분류">
            <Presence>
              {chips.mids.map((entry) => (
                <ChipMotion key={entry}>
                  <Chip active={mid === entry} onClick={() => onMid(mid === entry ? null : entry)}>
                    {entry}
                  </Chip>
                </ChipMotion>
              ))}
            </Presence>
          </ChipRow>
        ) : (
          <p className="m-0 text-[11px] text-text-tertiary">
            품목조회 파일이 적용되면 중/소분류로 좁힐 수 있습니다.
          </p>
        )}
        {chips.hasMaster && mid && minors.length > 0 ? (
          <ChipRow label="소분류">
            <Presence>
              {minors.map((entry) => (
                <ChipMotion key={entry}>
                  <Chip
                    active={minor === entry}
                    onClick={() => onMinor(minor === entry ? null : entry)}
                  >
                    {entry}
                  </Chip>
                </ChipMotion>
              ))}
            </Presence>
          </ChipRow>
        ) : null}
      </div>
    </StepCard>
  );
}

/**
 * 제품군을 바꾸면 바뀌는 중·소분류 칩 래퍼 (Motion 도입 스펙 §3.3 클라이언트 목록). 가로 flex-wrap 칩이라 height 접힘 대신
 * scaleIn(0.96↔1 + fade)으로 나타나고 사라지며, 남은 칩은 layout 으로 재배치된다. `Presence` 안에서만 쓴다 —
 * initial={false} 라 처음 렌더(페이지 로드·소분류 줄 첫 표시)의 칩은 애니메이션 없이 최종 상태.
 * 사용자 조작으로 바뀌지 않는 대분류(활성 표시) 칩은 감싸지 않는다.
 *
 * 퇴장 중인 칩은 layout 을 끈다(QA #40 CRITICAL): 제품군을 바꾸면 STEP 1 이 커지며 칩 줄 전체가 아래로 내려가는데,
 * 퇴장 칩이 layout 을 유지하면 옛 위치에서 새 위치까지 다른 카드 위를 쓸고 지나갔다. 이제 줄과 함께 한 프레임에 옮겨진 뒤
 * 그 자리에서 축소+fade 로 사라진다. 남은·새 칩의 재배치(layout)는 같은 줄 안에서만 일어난다.
 */
function ChipMotion({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <m.div
      layout={isPresent}
      // 퇴장 중 layout 해제를 테스트에서 확인하는 표식 (jsdom 은 레이아웃 투영을 재현하지 못한다)
      data-layout={isPresent ? 'on' : 'off'}
      variants={scaleIn}
      initial={VARIANT_KEYS.initial}
      animate={VARIANT_KEYS.animate}
      exit={VARIANT_KEYS.exit}
      transition={{ layout: transition.layout }}
    >
      {children}
    </m.div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium text-text-tertiary">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** STEP 3 · 품목명 + 수량 (운영중 + 선택 단가유형 최신 행 가격) */
export function StepItems({
  items,
  loading,
  selected,
  qty,
  onSelect,
  onQty,
}: {
  items: readonly QuoteItemView[];
  loading: boolean;
  selected: QuoteItemView | null;
  qty: number;
  onSelect: (item: QuoteItemView) => void;
  onQty: (qty: number) => void;
}) {
  return (
    <StepCard title="STEP 3 · 품목명">
      <ul
        aria-label="품목 목록"
        className="m-0 mb-4 flex max-h-[360px] list-none flex-col gap-2 overflow-y-auto p-0"
      >
        {items.map((item) => {
          const active = selected?.itemCode === item.itemCode;
          return (
            <li key={item.itemCode}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${item.itemName} (${item.itemCode})`}
                onClick={() => onSelect(item)}
                className={
                  active
                    ? 'flex w-full justify-between rounded-[10px] border-0 bg-primary-100 px-4 py-3 text-left text-[14px] font-semibold text-primary-700'
                    : 'flex w-full justify-between rounded-[10px] border-0 bg-transparent px-4 py-3 text-left text-[14px] font-medium shadow-(--hairline-subtle) hover:bg-surface-muted'
                }
              >
                <span>
                  {item.itemName}
                  <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">
                    {item.itemCode}
                  </span>
                </span>
                <span className="font-semibold">{priceLabel(item.unitPrice, item.currency)}</span>
              </button>
            </li>
          );
        })}
        {!loading && items.length === 0 ? (
          <li className="p-3.5 text-center text-[12px] text-text-tertiary">
            단가 유형을 먼저 선택하세요. 해당 조건의 운영중 품목이 없으면 비어 있습니다.
          </li>
        ) : null}
        {loading ? (
          <li className="p-3.5 text-center text-[12px] text-text-tertiary">불러오는 중…</li>
        ) : null}
      </ul>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium text-text-secondary">수량</span>
        <QtyControl value={qty} onChange={onQty} />
      </div>
    </StepCard>
  );
}

/** STEP 4 · 파츠 / STEP 5 · 결합형 체크 목록 */
export function StepOptions({
  title,
  emptyText,
  note,
  options,
  checked,
  onToggle,
}: {
  title: string;
  emptyText: string;
  note?: string;
  options: readonly QuoteItemView[];
  checked: ReadonlySet<string>;
  onToggle: (itemCode: string, on: boolean) => void;
}) {
  return (
    <StepCard title={title}>
      {note ? <p className="m-0 mb-2 text-[11px] text-text-tertiary">{note}</p> : null}
      <div className="flex flex-col gap-2" role="group" aria-label={title}>
        {options.map((option) => (
          <label
            key={option.itemCode}
            className="flex items-center justify-between rounded-[10px] px-3.5 py-3 text-[14px] font-medium shadow-(--hairline-subtle)"
          >
            <span className="flex items-center gap-2.5">
              <Checkbox
                checked={checked.has(option.itemCode)}
                onChange={(event) => onToggle(option.itemCode, event.target.checked)}
              />
              {option.itemName}
              <span className="text-[11px] font-normal text-text-tertiary">{option.itemCode}</span>
            </span>
            <span className="font-semibold text-text-secondary">
              +{priceLabel(option.unitPrice, option.currency)}
            </span>
          </label>
        ))}
        {options.length === 0 ? (
          <p className="m-0 py-2.5 text-[12px] text-text-tertiary">{emptyText}</p>
        ) : null}
      </div>
    </StepCard>
  );
}

/** STEP 6 · 할인율 슬라이더 ↔ 목표금액 역산 */
export function StepDiscount({
  preDiscount,
  lineTotal,
  currency,
  rate,
  target,
  onRate,
  onTarget,
}: {
  preDiscount: number;
  lineTotal: number;
  currency: string;
  rate: number;
  target: string;
  onRate: (rate: number) => void;
  onTarget: (target: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between rounded-xl bg-surface-muted px-6 py-[18px]">
        <span className="text-[14px] font-semibold text-text-secondary">
          할인 적용 전 금액 (수량 반영)
        </span>
        <span className="text-[17px] font-bold" data-testid="pre-discount">
          {priceLabel(preDiscount, currency)}
        </span>
      </div>
      <StepCard title="STEP 6 · 할인율">
        <div className="mb-3.5 flex items-center gap-2.5">
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={rate}
            aria-label="할인율"
            className="flex-1"
            onChange={(event) => onRate(Number(event.target.value))}
          />
          <span className="w-[52px] text-right text-[15px] font-bold" data-testid="discount-rate">
            {rate}%
          </span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">
            목표 금액으로 역산 (할인율 자동 계산)
          </span>
          <Input
            type="number"
            inputMode="numeric"
            name="targetAmount"
            value={target}
            placeholder="예: 25000000"
            onChange={(event) => onTarget(event.target.value)}
          />
          {target !== '' ? (
            <span className="text-[11px] text-text-tertiary">
              역산 할인율 {rateFromTarget(Number(target), preDiscount)}% · 목표{' '}
              {formatAmount(Number(target) || 0)}
            </span>
          ) : null}
        </label>
        <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
          <span className="text-[14px] font-semibold text-text-secondary">
            할인 적용 후 금액 (1,000원 단위 절삭)
          </span>
          <span className="text-[18px] font-bold text-primary-600" data-testid="line-total">
            {priceLabel(lineTotal, currency)}
          </span>
        </div>
      </StepCard>
    </>
  );
}
