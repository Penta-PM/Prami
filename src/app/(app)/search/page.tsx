import type { Metadata } from 'next';

import { getDb } from '@/db';
import { SearchResults } from '@/features/search/SearchResults';
import { requirePagePermission } from '@/server/auth/rbac';
import { normalizeQuery, searchAll } from '@/server/search/queries';

export const metadata: Metadata = { title: '검색' };

type SearchPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 통합 검색 결과 (§4.5.4, AC-52): 헤더 검색 폼 `?q=` → 품목·공지 결과 그룹 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  await requirePagePermission('search', '/search');
  const query = normalizeQuery((await searchParams).q);
  const result = await searchAll(await getDb(), query);
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-[18px]">
      <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
        검색
      </h1>
      <SearchResults result={result} />
    </section>
  );
}
