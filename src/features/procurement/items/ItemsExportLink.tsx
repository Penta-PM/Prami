import { itemsExportHref, type ItemsView } from './filter';

/**
 * xlsx 내려받기 (현재 검색·열 필터·정렬 결과 — 페이지 무시). 상한(limit)을 넘으면 앞에서부터 상한까지만 내려간다는 안내를 미리 보인다
 * (파일 맨 아래에도 같은 안내 줄이 들어간다). ProcurementHeader actions 자리.
 */
export function ItemsExportLink({
  view,
  total,
  limit,
}: {
  view: ItemsView;
  total: number;
  limit: number;
}) {
  const truncated = total > limit;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {truncated ? (
        <p id="procurement-items-export-note" className="m-0 text-[12px] text-amber-700">
          결과 {total.toLocaleString('ko-KR')}건 중 앞의 {limit.toLocaleString('ko-KR')}건만
          내려받습니다
        </p>
      ) : null}
      <a
        href={itemsExportHref(view)}
        download
        aria-describedby={truncated ? 'procurement-items-export-note' : undefined}
        className="inline-flex h-8 items-center rounded-lg bg-gray-75 px-3 text-[12px] font-semibold text-text-secondary no-underline shadow-(--hairline-subtle) hover:bg-gray-100 hover:text-ink-900 hover:no-underline"
      >
        xlsx 내려받기
      </a>
    </div>
  );
}
