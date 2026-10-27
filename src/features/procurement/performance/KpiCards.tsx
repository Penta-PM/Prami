import { cn } from '@/lib/cn';

import type { KpiCard, Tone } from './model';

export const TONE_TEXT: Record<Exclude<Tone, null>, string> = {
  good: 'text-green-700',
  bad: 'text-red-600',
};

/**
 * 임원 보고용 큰 숫자 + 라벨 (원본 HeroStat — 누적매출 / 점유율 / 경쟁사 대비 / 전년 대비). 금액 = 억·만(D-3).
 * 증감 색에는 부호(+/−)가 함께 있어 색만으로 구분하지 않는다.
 */
export function KpiCards({ cards }: { cards: readonly KpiCard[] }) {
  return (
    <dl
      aria-label="조회 기간 요약"
      className="m-0 grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4"
    >
      {cards.map((card) => (
        <div
          key={card.key}
          data-kpi={card.key}
          className="flex min-w-0 flex-col rounded-2xl bg-surface-muted px-5 py-4 shadow-(--hairline-subtle)"
        >
          <dt className="mb-2 text-[14px] font-semibold text-text-secondary">{card.label}</dt>
          <dd
            className={cn(
              'm-0 truncate text-[24px] leading-tight font-bold tabular-nums sm:text-[28px]',
              card.tone ? TONE_TEXT[card.tone] : 'text-text-primary',
            )}
            title={card.value}
          >
            {card.value}
          </dd>
          <dd className="m-0 mt-1 min-h-4 truncate text-[12px] text-text-tertiary" title={card.sub}>
            {card.sub}
          </dd>
        </div>
      ))}
    </dl>
  );
}
