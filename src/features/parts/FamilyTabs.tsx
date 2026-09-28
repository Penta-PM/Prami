import Link from 'next/link';

import { cn } from '@/lib/cn';

type FamilyTabsProps = {
  families: readonly string[];
  active: string;
  basePath: string;
  /** 탭별 건수 (선택) */
  counts?: Readonly<Record<string, number>>;
};

/** 제품군 탭 (디자인 partsProductTabs/groupsProductTabs). URL `?family=` 로 상태를 유지한다 */
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
              'flex items-center gap-1.5 border-b-2 px-1.5 py-[11px] text-[14px] no-underline hover:no-underline',
              isActive
                ? 'border-ink-900 font-semibold text-ink-900'
                : 'border-transparent font-medium text-text-tertiary hover:text-ink-900',
            )}
          >
            {family}
            {counts && counts[family] !== undefined ? (
              <span className="text-[11px] font-semibold text-text-tertiary">{counts[family]}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
