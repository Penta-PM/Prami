'use client';

import Link from 'next/link';
import { useState } from 'react';

import { FOCUS_RING_CLASSES, PRESS_CLASSES } from '@/components/ui/button';
import { BottomSheet } from '@/components/ui/sheet';
import { signOutAction } from '@/features/auth/actions';
import { cn } from '@/lib/cn';

import type { HeaderUser } from './Header';

const SHEET_ROW_CLASSES = cn(
  'flex min-h-11 w-full items-center rounded-lg border-0 bg-transparent px-3 text-left text-[16px] font-semibold text-text-primary no-underline hover:bg-neutral-100 hover:text-text-primary hover:no-underline',
  PRESS_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * 모바일 계정 메뉴 (모바일 UI 스펙 §3 헤더·§5 M0): 헤더 오른쪽 아바타(44px)를 누르면 하단 시트 — 이름/역할, 사용자 설정,
 * 로그아웃. 768px 이상은 렌더는 되지만 숨겨진다(md:hidden) — 데스크톱은 기존 헤더의 이름·설정 링크·로그아웃을 그대로 쓴다.
 * 모바일에서 "사용자 설정"으로 갈 길이 없던 결함(스펙 §1 Header.tsx:56)을 이것으로 고친다.
 */
export function AccountMenu({ user, initial }: { user: HeaderUser; initial: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="계정 메뉴"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-circle border-0 bg-transparent p-0 md:hidden',
          PRESS_CLASSES,
          FOCUS_RING_CLASSES,
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-[34px] items-center justify-center rounded-circle bg-surface-inverse text-[14px] font-semibold text-text-inverse"
        >
          {initial}
        </span>
      </button>
      {/* 열렸을 때만 마운트 — 닫힌 시트의 이름·역할이 헤더 DOM 에 중복으로 남지 않게. 닫기·Esc·배경은 Modal 이 퇴장 모션 후 onClose */}
      {open ? (
        <BottomSheet open onClose={() => setOpen(false)} title="계정">
          <div className="mb-4 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-circle bg-surface-inverse text-[16px] font-semibold text-text-inverse"
            >
              {initial}
            </span>
            <div className="min-w-0 leading-[1.4]">
              <div className="truncate text-[16px] font-semibold text-text-primary">
                {user.name}
              </div>
              {user.roleLabel ? (
                <div className="truncate text-[14px] text-text-tertiary">{user.roleLabel}</div>
              ) : null}
            </div>
          </div>
          <nav aria-label="계정" className="flex flex-col gap-2">
            <Link href="/settings" onClick={() => setOpen(false)} className={SHEET_ROW_CLASSES}>
              사용자 설정
            </Link>
            <form action={signOutAction}>
              <button type="submit" className={SHEET_ROW_CLASSES}>
                로그아웃
              </button>
            </form>
          </nav>
        </BottomSheet>
      ) : null}
    </>
  );
}
