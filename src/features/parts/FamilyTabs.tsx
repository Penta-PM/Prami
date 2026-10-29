import Link from 'next/link';

import { cn } from '@/lib/cn';

import { FamilyTabIndicator } from './FamilyTabIndicator';

type FamilyTabsProps = {
  families: readonly string[];
  active: string;
  basePath: string;
  /** 탭별 건수 (선택) */
  counts?: Readonly<Record<string, number>>;
};

/**
 * 제품군 탭 (디자인 partsProductTabs/groupsProductTabs). URL `?family=` 로 상태를 유지한다.
 * 활성 밑줄은 client `FamilyTabIndicator`(layoutId) 가 그린다 — 2px 테두리는 모든 탭에 투명으로 남겨 높이·정렬을 유지한다
 * (Motion 도입 스펙 §3.3). layoutId 는 basePath 별로 둔다 — 부품·그룹 화면의 밑줄이 서로 섞이지 않는다.
 */
export function FamilyTabs({ families, active, basePath, counts }: FamilyTabsProps) {
  return (
    <nav aria-label="제품군" className="flex gap-1.5 border-b border-border-subtle">
      {families.map((family) => {
        const isActive = family === active;
        return (
          <Link
            key={family}
            href={`${basePath}?family=${encodeURIComponent(family)}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-1.5 border-b-2 border-transparent px-1.5 py-[11px] text-[14px] no-underline hover:no-underline',
              isActive
                ? 'font-semibold text-text-primary'
                : 'font-medium text-text-tertiary hover:text-text-primary',
            )}
          >
            {family}
            {counts && counts[family] !== undefined ? (
              <span className="text-[11px] font-semibold text-text-tertiary">{counts[family]}</span>
            ) : null}
            {isActive ? <FamilyTabIndicator layoutId={`family-tab-indicator:${basePath}`} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
