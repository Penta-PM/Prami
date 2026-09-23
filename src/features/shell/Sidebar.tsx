'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { cn } from '@/lib/cn';

import { Icon } from './icons';
import { NAV_ADMIN, NAV_MAIN, isNavActive, type NavItem } from './nav';

/**
 * 앱 셸 사이드바. 접기/펼치기 상태를 가진다.
 * 디자인의 "보기 권한" 역할 토글은 제거했고, 관리자 메뉴 노출은 PR-2에서 세션 역할로 결정한다.
 */
export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(true);
  const pathname = usePathname();

  return (
    <aside
      aria-label="주 메뉴"
      data-expanded={isExpanded}
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col gap-7 border-r border-border-subtle bg-surface-sidebar py-6 transition-[width] duration-200',
        isExpanded ? 'w-(--sidebar-width) px-4' : 'w-[72px] px-3',
      )}
    >
      <SidebarLogo isExpanded={isExpanded} />

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV_MAIN.map((item) => (
          <SidebarLink
            key={item.key}
            item={item}
            isActive={isNavActive(pathname, item.href)}
            isExpanded={isExpanded}
          />
        ))}

        {isExpanded ? (
          <div className="mx-2 mt-5 mb-2 text-[11px] font-semibold tracking-[0.04em] text-text-tertiary">
            관리자
          </div>
        ) : (
          <div aria-hidden="true" className="my-3 border-t border-border-subtle" />
        )}
        {NAV_ADMIN.map((item) => (
          <SidebarLink
            key={item.key}
            item={item}
            isActive={isNavActive(pathname, item.href)}
            isExpanded={isExpanded}
          />
        ))}
      </nav>

      <div className="border-t border-border-subtle pt-4">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
          aria-label="사이드바 접기/펼치기"
          title="사이드바 접기/펼치기"
          className="w-full rounded-lg border-0 bg-gray-75 py-[9px] text-[12px] font-semibold text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900"
        >
          {isExpanded ? '« 접기' : '»'}
        </button>
      </div>
    </aside>
  );
}

function SidebarLogo({ isExpanded }: { isExpanded: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', isExpanded ? 'px-2' : 'justify-center')}>
      <Image
        src="/logo-prami-mark.png"
        alt="Prami"
        width={34}
        height={31}
        priority
        className="h-[31px] w-[34px] shrink-0 object-contain"
      />
      {isExpanded ? (
        <span className="whitespace-nowrap text-ink-900 [font:var(--text-wordmark)]">Prami</span>
      ) : null}
    </div>
  );
}

type SidebarLinkProps = { item: NavItem; isActive: boolean; isExpanded: boolean };

function SidebarLink({ item, isActive, isExpanded }: SidebarLinkProps) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        '-mx-1 flex items-center gap-3 rounded-lg py-[11px] text-[14px] no-underline transition-colors hover:no-underline',
        isExpanded ? 'justify-start px-3' : 'justify-center px-0',
        isActive
          ? 'bg-lime-500 font-semibold text-ink-900 hover:text-ink-900'
          : 'font-medium text-text-secondary hover:bg-gray-100 hover:text-ink-900',
      )}
    >
      <Icon
        name={item.icon}
        className={cn('size-[18px] shrink-0', isActive ? 'text-ink-900' : 'text-text-tertiary')}
      />
      {isExpanded ? <span className="whitespace-nowrap">{item.label}</span> : null}
    </Link>
  );
}
