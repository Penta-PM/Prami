import { useId } from 'react';

import { cn } from '@/lib/cn';
import { priceChangeDisplay, priceTypeLabel } from '@/lib/pricing/format';

import type { CostRatioReason, CostRatioView } from './types';

/**
 * 표 셀 표시 (디자인 가격정책 표): 품목상태 색상 필(R-09, AC-14/22), 운영상태 아이콘+텍스트.
 * 상태는 색상만이 아니라 텍스트로도 구분한다 (§4.8 접근성).
 */
const ITEM_STATUS_CLASSES: Record<string, string> = {
  폐기: 'bg-red-500/12 text-red-500',
  임시: 'bg-[#fdf1de] text-[#a86a00]',
  사용: 'bg-gray-100 text-text-secondary',
  미확인: 'bg-transparent text-text-tertiary shadow-(--hairline-default)',
};

export function ItemStatusPill({ status }: { status: string }) {
  return (
    <span
      data-item-status={status}
      className={cn(
        'inline-flex items-center rounded-pill px-[9px] py-[3px] text-[11px] font-semibold whitespace-nowrap',
        ITEM_STATUS_CLASSES[status] ?? ITEM_STATUS_CLASSES['미확인'],
      )}
    >
      {status}
    </span>
  );
}

/** 운영중 = 파랑 채운 원, 미사용 = 회색 빈 원 (디자인 status-active/inactive 아이콘 대체) */
export function OperationStatus({ status }: { status: '운영중' | '미사용' }) {
  const active = status === '운영중';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] text-[12px] font-semibold whitespace-nowrap',
        active ? 'text-[#3075FF]' : 'text-[#797C85]',
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 shrink-0">
        {active ? (
          <circle cx="7" cy="7" r="5" fill="currentColor" />
        ) : (
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
      {status}
    </span>
  );
}

/**
 * 가격 변동 (cost-ratio-price-change §2.4): 화살표는 aria-hidden, 상승·하락은 텍스트로 구분한다.
 * 색: 상승 = text-danger(--red-600, 흰 배경 6:1), 하락 = purple-600(#6c55e0, 4.6:1 이상) — 국내 관례(상승 빨강·하락 파랑 계열),
 * 변동 없음·'—' = text-tertiary. 모두 기존 AA 토큰이다(현재 앱에 다크 테마 없음).
 */
const PRICE_CHANGE_CLASSES = {
  up: 'text-text-danger',
  down: 'text-purple-600',
  same: 'text-text-tertiary',
  none: 'text-text-tertiary',
} as const;

export function PriceChange({
  unitPrice,
  previousPrice,
  rate,
  id,
}: {
  unitPrice: string;
  previousPrice: string | null;
  rate: number | null;
  /** 변동 이력 버튼의 aria-describedby 대상 (보이는 변동 텍스트) */
  id?: string;
}) {
  const display = priceChangeDisplay(unitPrice, previousPrice, rate);
  return (
    <span
      id={id}
      data-price-change={display.kind}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap',
        PRICE_CHANGE_CLASSES[display.kind],
      )}
    >
      {display.kind === 'up' || display.kind === 'down' ? (
        <>
          <span aria-hidden="true">{display.arrow}</span>
          {display.text}
        </>
      ) : display.kind === 'same' ? (
        display.text
      ) : (
        '—'
      )}
    </span>
  );
}

/**
 * 가격 변동 칸 = 변동 이력 모달 트리거 (price-change-history-modal §2.2). 표시·색은 PriceChange 그대로, 밑줄·hover 배경만 더한다.
 * - 이름 "{품명} {단가유형} 가격 변동 이력", 보이는 변동 텍스트는 aria-describedby 로 남긴다. '—' 칸도 같은 버튼이다.
 * - click 은 stopPropagation — 행 클릭(상세 드로어)이 함께 열리지 않는다(열 타입은 number 그대로).
 * - 열기 전에 버튼에 포커스를 둔다 — 클릭으로 포커스를 주지 않는 브라우저(Safari)에서도 모달이 닫히면 이 버튼으로 돌아온다.
 */
export function PriceChangeButton({
  row,
  onOpen,
}: {
  row: {
    itemName: string;
    priceType: string | null;
    unitPrice: string;
    previousPrice?: string | null;
    priceChangeRate?: number | null;
  };
  onOpen: () => void;
}) {
  const textId = useId();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${row.itemName} ${priceTypeLabel(row.priceType)} 가격 변동 이력`}
      aria-describedby={textId}
      data-price-history-trigger=""
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus();
        onOpen();
      }}
      className={cn(
        'inline-flex cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left [font:inherit]',
        'underline decoration-dotted underline-offset-[3px] hover:bg-gray-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500',
      )}
    >
      <PriceChange
        id={textId}
        unitPrice={row.unitPrice}
        previousPrice={row.previousPrice ?? null}
        rate={row.priceChangeRate ?? null}
      />
    </button>
  );
}

const COST_RATIO_REASON_TEXT: Record<CostRatioReason, string> = {
  'no-cost': '해당 시기 원가 없음',
  'zero-price': '판매가 0',
  currency: '화폐 불일치',
};

/** 원가 비중 % 표기 — 소수 1자리 고정(서버가 half-up 으로 반올림한 값) */
export function costRatioLabel(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * 원가 비중 칸 (cost-ratio-price-change §2.2-5): 값이 있으면 `NN.N%` + 툴팁 "원가 적용일 YYYY-MM-DD",
 * '—' 는 사유 툴팁(해당 시기 원가 없음·판매가 0·화폐 불일치). 대상이 아닌 행(정상판매 아님·매핑 없음)은 툴팁 없는 '—'.
 * 툴팁은 title + 스크린리더용 숨김 텍스트로 같은 내용을 준다.
 */
export function CostRatio({ value }: { value: CostRatioView | undefined }) {
  if (!value) return <span className="text-text-tertiary">—</span>;
  if (value.costRatio === null) {
    const reason = COST_RATIO_REASON_TEXT[value.reason];
    return (
      <span title={reason} data-cost-ratio-reason={value.reason} className="text-text-tertiary">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{reason}</span>
      </span>
    );
  }
  const tooltip = `원가 적용일 ${value.costFrom}`;
  return (
    <span title={tooltip} className="whitespace-nowrap tabular-nums">
      {costRatioLabel(value.costRatio)}
      <span className="sr-only"> ({tooltip})</span>
    </span>
  );
}
