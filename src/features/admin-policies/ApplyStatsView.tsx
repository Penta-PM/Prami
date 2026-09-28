import type { PolicyApplyStats } from '@/db/schema';

const STAT_LABELS: readonly [keyof PolicyApplyStats, string][] = [
  ['inserted', 'ERP 적재 행'],
  ['seriesCount', '계열 수'],
  ['latestCount', '계열 최신 행'],
  ['operatingCount', '운영중'],
  ['discardedForced', '폐기로 미사용 처리'],
  ['itemsApplied', '품목 마스터 반영'],
  ['missingItems', '마스터에 없는 품번(미확인)'],
  ['unmappedItemStatus', '매핑 불가 품목상태'],
  ['manualPreserved', '수동 등록 보존'],
  ['manualConflicts', '수동 등록 → ERP 우선 대체'],
  ['finalSourceMismatch', '원본 최종여부와 다른 행'],
];

/** 적용 결과 통계 (run.stats) */
export function ApplyStatsView({ title, stats }: { title: string; stats: PolicyApplyStats }) {
  return (
    <div
      role="status"
      aria-label={title}
      className="rounded-lg bg-surface-card p-3.5 shadow-(--hairline-default)"
    >
      <p className="m-0 mb-2 text-[12px] font-semibold text-green-600">{title}</p>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
        {STAT_LABELS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-3">
            <dt className="text-text-tertiary">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums">
              {(stats[key] ?? 0).toLocaleString('ko-KR')}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
