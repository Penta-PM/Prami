'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { transition } from '@/lib/motion/tokens';

import { Icon } from './icons';
import { NAV_ADMIN, NAV_MAIN, isNavActive, type NavItem } from './nav';

/**
 * 앱 셸 사이드바. 접기/펼치기 상태를 가진다.
 * 디자인의 "보기 권한" 역할 토글은 제거했고, 관리자 메뉴는 세션 역할로 노출한다.
 * 메뉴 숨김은 표시용일 뿐 보안 경계가 아니다 (proxy·requirePermission 이 막는다).
 * 좁은 화면(md 미만, PRAMI-003 AC-375 ② — 320px 에서 본문 폭 확보)은 레이아웃 폭을 차지하지 않는 오버레이다:
 * 기본은 화면 밖(보이지 않고 탭 이동에서도 빠짐), [메뉴] 버튼으로 열고 메뉴 선택·바깥 누름·Esc 로 닫는다.
 * 열면 첫 메뉴로, Esc·바깥 누름으로 닫으면 [메뉴] 버튼으로 포커스를 옮긴다(메뉴 선택은 이동한 화면에 둔다).
 *
 * 모션 (Motion 도입 스펙 §3.3 사이드바): 폭 전환·모바일 translate 는 CSS transition 그대로 두고(E2E 가 boundingBox 를 단언),
 * 펼칠 때 라벨 텍스트와 "관리자" 헤더만 fade-in(`transition.fast`) 한다. 접을 때는 main 과 같이 즉시 제거한다 — 퇴장 fade 중
 * 라벨이 자리를 차지하면 justify-center 된 링크에서 아이콘이 링크 밖(음수 x)으로 밀렸다가 튀어 돌아온다 (스펙 §9.3, Plan A안).
 * 서버 렌더 요소라 첫 렌더에는 숨김 initial 을 주지 않는다 — 사용자가 토글한 뒤(`labelsFadeIn`)부터만 fade-in. Motion `layout` 은 쓰지 않는다.
 * 제거는 Presence 를 거치지 않는 조건부 렌더라 접는 커밋에서 바로 빠진다(Presence 는 exit 가 없어도 한 프레임 늦게 제거).
 */
export function Sidebar({ showAdminNav = false }: { showAdminNav?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(true);
  // 사용자가 접기/펼치기를 한 번이라도 했는지 — 그 뒤부터만 라벨 fade-in (첫 서버 렌더는 initial 없음)
  const [labelsFadeIn, setLabelsFadeIn] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const closeMobile = () => setIsMobileOpen(false);
  const dismissMobile = () => {
    setIsMobileOpen(false);
    menuButtonRef.current?.focus();
  };

  // 열려 있는 동안 어디에 포커스가 있든 Esc 로 닫는다
  useEffect(() => {
    if (!isMobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsMobileOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMobileOpen]);

  // 열리면 첫 메뉴로 포커스 (invisible 이 풀린 다음 프레임)
  useEffect(() => {
    if (!isMobileOpen) return;
    const frame = requestAnimationFrame(() => asideRef.current?.querySelector('a')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isMobileOpen]);

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setIsMobileOpen((value) => !value)}
        aria-expanded={isMobileOpen}
        aria-controls="app-sidebar"
        aria-label={isMobileOpen ? '메뉴 닫기' : '메뉴 열기'}
        className="fixed top-[18px] left-3 z-50 flex size-9 items-center justify-center rounded-lg border-0 bg-gray-75 text-[18px] text-ink-900 shadow-(--hairline-subtle) md:hidden"
      >
        <span aria-hidden="true">{isMobileOpen ? '×' : '☰'}</span>
      </button>
      {isMobileOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="메뉴 닫기"
          onClick={dismissMobile}
          className="fixed inset-0 z-30 border-0 bg-ink-900/30 transition-opacity duration-200 motion-reduce:transition-none md:hidden starting:opacity-0"
        />
      ) : null}
      <aside
        ref={asideRef}
        id="app-sidebar"
        aria-label="주 메뉴"
        data-expanded={isExpanded}
        data-mobile-open={isMobileOpen}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) closeMobile();
        }}
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col gap-7 border-r border-border-subtle bg-surface-sidebar py-6 transition-[width,transform] duration-200',
          isExpanded ? 'w-(--sidebar-width) px-4' : 'w-[72px] px-3',
          'max-md:fixed max-md:left-0 max-md:z-40 max-md:w-(--sidebar-width) max-md:px-4 max-md:pt-16 max-md:shadow-xl',
          isMobileOpen ? '' : 'max-md:invisible max-md:-translate-x-full',
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
              fadeIn={labelsFadeIn}
            />
          ))}

          {showAdminNav ? (
            <>
              {isExpanded ? (
                <m.div
                  {...labelFade(labelsFadeIn)}
                  className="mx-2 mt-5 mb-2 text-[11px] font-semibold tracking-[0.04em] text-text-tertiary"
                >
                  관리자
                </m.div>
              ) : (
                <div aria-hidden="true" className="my-3 border-t border-border-subtle" />
              )}
              {NAV_ADMIN.map((item) => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  isActive={isNavActive(pathname, item.href)}
                  isExpanded={isExpanded}
                  fadeIn={labelsFadeIn}
                />
              ))}
            </>
          ) : null}
        </nav>

        <div className="border-t border-border-subtle pt-4 max-md:hidden">
          <button
            type="button"
            onClick={() => {
              setLabelsFadeIn(true);
              setIsExpanded((value) => !value);
            }}
            aria-expanded={isExpanded}
            aria-label="사이드바 접기/펼치기"
            title="사이드바 접기/펼치기"
            className="w-full rounded-lg border-0 bg-gray-75 py-[9px] text-[12px] font-semibold text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900"
          >
            {isExpanded ? '« 접기' : '»'}
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * 라벨 fade-in (스펙 §3.3 사이드바·§9.3): 펼칠 때만 opacity 0→1 + `transition.fast`. 첫 렌더(fadeIn=false)는 initial 없음.
 * 퇴장 애니메이션은 없다(접을 때 즉시 제거). 색은 CSS transition-colors 가 맡는다
 */
function labelFade(fadeIn: boolean) {
  return {
    initial: fadeIn ? { opacity: 0 } : false,
    animate: { opacity: 1 },
    transition: transition.fast,
  } as const;
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

type SidebarLinkProps = { item: NavItem; isActive: boolean; isExpanded: boolean; fadeIn: boolean };

function SidebarLink({ item, isActive, isExpanded, fadeIn }: SidebarLinkProps) {
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
      {isExpanded ? (
        <m.span {...labelFade(fadeIn)} className="whitespace-nowrap">
          {item.label}
        </m.span>
      ) : null}
    </Link>
  );
}
