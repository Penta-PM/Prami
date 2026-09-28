import Link from 'next/link';

import { Pill } from '@/components/ui';
import { NoticeRows } from '@/features/notices/NoticeRows';
import { SEARCH_LIMIT, type SearchResult } from '@/server/search/queries';

const ITEM_STATUS_LABEL: Record<string, string> = {
  active: '사용',
  temporary: '임시',
  discarded: '폐기',
};

/** 검색 결과 페이지 (§4.5.4, AC-52): 품목 그룹 → `/pricing?q=품번`, 공지 그룹 → 상세. 원가 값은 없다 */
export function SearchResults({ result }: { result: SearchResult }) {
  if (!result.query) {
    return (
      <p className="m-0 text-[13px] text-text-tertiary">
        상단 검색창에 제품, 모델, 품번, 공지사항 제목을 입력하세요.
      </p>
    );
  }
  const total = result.items.length + result.notices.length;
  const anyTruncated = result.truncated.items || result.truncated.notices;
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[13px] text-text-tertiary">
        <strong className="text-ink-900">“{result.query}”</strong> 검색 결과 {total}건 (품목{' '}
        {result.items.length} · 공지 {result.notices.length})
        {anyTruncated ? (
          <span role="note" className="ml-2 text-amber-500">
            그룹당 상위 {SEARCH_LIMIT}건만 표시합니다 — 검색어를 더 구체적으로 입력하세요
          </span>
        ) : null}
      </p>
      <section
        aria-labelledby="search-items"
        className="rounded-xl bg-surface-card shadow-(--hairline-default)"
      >
        <h2
          id="search-items"
          className="m-0 border-b border-border-subtle px-5 py-4 [font:var(--text-h2)]"
        >
          품목{' '}
          <span className="text-[13px] font-medium text-text-tertiary">
            {result.truncated.items ? `상위 ${SEARCH_LIMIT}건` : result.items.length}
          </span>
        </h2>
        {result.items.length === 0 ? (
          <p className="m-0 py-10 text-center text-[13px] text-text-tertiary">
            일치하는 품목이 없습니다.
          </p>
        ) : (
          <ul aria-label="품목 결과" className="m-0 flex list-none flex-col p-0">
            {result.items.map((item) => (
              <li key={item.itemCode} className="border-b border-border-subtle last:border-b-0">
                <Link
                  href={`/pricing?q=${encodeURIComponent(item.itemCode)}`}
                  className="flex items-center gap-3 px-5 py-4 text-ink-900 no-underline hover:bg-gray-75 hover:no-underline"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {item.itemName}
                  </span>
                  <span className="shrink-0 text-[12px] text-text-tertiary">{item.itemCode}</span>
                  <Pill tone="neutral">{item.productFamily}</Pill>
                  {item.itemStatus ? (
                    <Pill tone={item.itemStatus === 'discarded' ? 'red' : 'positive'}>
                      {ITEM_STATUS_LABEL[item.itemStatus] ?? item.itemStatus}
                    </Pill>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        aria-labelledby="search-notices"
        className="rounded-xl bg-surface-card shadow-(--hairline-default)"
      >
        <h2
          id="search-notices"
          className="m-0 border-b border-border-subtle px-5 py-4 [font:var(--text-h2)]"
        >
          공지사항{' '}
          <span className="text-[13px] font-medium text-text-tertiary">
            {result.truncated.notices ? `상위 ${SEARCH_LIMIT}건` : result.notices.length}
          </span>
        </h2>
        <NoticeRows notices={result.notices} emptyText="일치하는 공지가 없습니다." />
      </section>
    </div>
  );
}
