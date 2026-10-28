'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/icons/Icon';
import { FOCUS_RING_CLASSES } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { transition } from '@/lib/motion/tokens';

import { NavIcon } from './icons';
import {
  NAV_MAIN,
  adminNavItems,
  pricingNavItems,
  getProcurementNavItems,
  isNavActive,
  type NavItem,
  type NavVisibility,
} from './nav';

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
 *
 * 섹션: 일반(HOME) → "가격 정책"(가격 정책 조회 pricing.read·계산기 calculator.use, UX PR-U1 · 가격 정책 챗봇 chat.use, UX PR-C2)
 *   → "조달"(procurement.read, 조달이 통합 UI-1 · 조달 챗봇은 chat.use 도, UX PR-C2)
 *   → "관리자"(관리자 영역, "조달 관리"는 procurement.write 일 때만 — D-2).
 * 노출 값은 레이아웃이 세션 역할로 계산한다(navVisibility).
 */
export function Sidebar({
  showPricingNav = false,
  showCalculatorNav = false,
  showChatNav = false,
  showAdminNav = false,
  showProcurementNav = false,
  showProcurementAdminNav = false,
}: Partial<NavVisibility>) {
  const [isExpanded, setIsExpanded] = useState(true);
  // 사용자가 접기/펼치기를 한 번이라도 했는지 — 그 뒤부터만 라벨 fade-in (첫 서버 렌더는 initial 없음)
  const [labelsFadeIn, setLabelsFadeIn] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pathname = usePathname();
  const pricingItems = pricingNavItems({ showPricingNav, showCalculatorNav, showChatNav });
  const visibleProcurementItems = getProcurementNavItems({ showProcurementNav, showChatNav });
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
        {/* ☰ 는 Penta 에 없어 기존 글리프 유지(보류), 닫기는 Penta close */}
        {isMobileOpen ? <Icon name="close" /> : <span aria-hidden="true">☰</span>}
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

          {pricingItems.length > 0 ? (
            <>
              <SectionHeader isExpanded={isExpanded} fadeIn={labelsFadeIn}>
                가격 정책
              </SectionHeader>
              {pricingItems.map((item) => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  isActive={isNavActive(pathname, item.href, item.exact)}
                  isExpanded={isExpanded}
                  fadeIn={labelsFadeIn}
                />
              ))}
            </>
          ) : null}

          {visibleProcurementItems.length > 0 ? (
            <>
              <SectionHeader isExpanded={isExpanded} fadeIn={labelsFadeIn}>
                조달
              </SectionHeader>
              {visibleProcurementItems.map((item) => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  isActive={isNavActive(pathname, item.href, item.exact)}
                  isExpanded={isExpanded}
                  fadeIn={labelsFadeIn}
                />
              ))}
            </>
          ) : null}

          {showAdminNav ? (
            <>
              <SectionHeader isExpanded={isExpanded} fadeIn={labelsFadeIn}>
                관리자
              </SectionHeader>
              {adminNavItems({ showProcurementAdminNav }).map((item) => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  isActive={isNavActive(pathname, item.href, item.exact)}
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

/** 섹션 머리("가격 정책"·"조달"·"관리자"). 접힌 사이드바에서는 구분선 */
function SectionHeader({
  isExpanded,
  fadeIn,
  children,
}: {
  isExpanded: boolean;
  fadeIn: boolean;
  children: string;
}) {
  return isExpanded ? (
    <m.div
      {...labelFade(fadeIn)}
      className="mx-2 mt-5 mb-2 text-[11px] font-semibold tracking-[0.04em] text-text-tertiary"
    >
      {children}
    </m.div>
  ) : (
    <div aria-hidden="true" className="my-3 border-t border-border-subtle" />
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

type SidebarLinkProps = { item: NavItem; isActive: boolean; isExpanded: boolean; fadeIn: boolean };

function SidebarLink({ item, isActive, isExpanded, fadeIn }: SidebarLinkProps) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative -mx-1 flex items-center gap-3 rounded-lg py-[11px] text-[14px] no-underline transition-colors hover:no-underline',
        FOCUS_RING_CLASSES,
        isExpanded ? 'justify-start px-3' : 'justify-center px-0',
        // 활성 (Penta 디자인 PR-2, Plan 결정 — 문서에 내비 정의 없음): P50 바탕 + P700 글자(8.3:1) + 왼쪽 3px P500 막대
        isActive
          ? 'bg-primary-50 font-semibold text-primary-700 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary-500 hover:text-primary-700'
          : 'font-medium text-text-secondary hover:bg-gray-100 hover:text-ink-900',
      )}
    >
      <NavIcon name={item.icon} className={isActive ? 'text-primary-700' : 'text-text-tertiary'} />
      {isExpanded ? (
        <m.span {...labelFade(fadeIn)} className="whitespace-nowrap">
          {item.label}
        </m.span>
      ) : null}
    </Link>
  );
}
