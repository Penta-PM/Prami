'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useTransition } from 'react';

import { navigateView } from '@/lib/page-state/view-navigation';
import { performanceHref, type PerformanceView } from '@/lib/procurement/performance-filter';

/**
 * 실적 현황 조작 → URL (조달이 통합 UI-5). URL 이 상태다 — 조작은 `router.replace`(뒤로 가기 기록을 쌓지 않음, 빠른 필터 바 §2.3),
 * 서버 page 가 새 URL 로 다시 집계한다. 빠른 연속 조작(R1 — 입찰 공고 필터 바와 같은 규칙): URL 이 아직 바뀌지 않았으면
 * 다음 조건은 마지막 요청에서 계산한다.
 */
export function usePerformanceNav(view: PerformanceView) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pending = useRef<{ target: PerformanceView; fromHref: string } | null>(null);

  const navigate = useCallback(
    (patch: Partial<PerformanceView>) => {
      const currentHref = performanceHref(view);
      const last = pending.current;
      const base = last && last.fromHref === currentHref ? last.target : view;
      const target: PerformanceView = { ...base, ...patch };
      pending.current = { target, fromHref: currentHref };
      navigateView(performanceHref(target), (href) =>
        startTransition(() => router.replace(href, { scroll: false })),
      );
    },
    [view, router],
  );

  return { navigate, isPending };
}
