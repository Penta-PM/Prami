'use client';

import { m } from 'motion/react';
import { useState } from 'react';

import { Segmented } from '@/components/ui';
import { transition } from '@/lib/motion/tokens';

import { MarginCalculator } from './MarginCalculator';
import { QuoteCalculator } from './QuoteCalculator';
import type { FamilyPreload, SavedQuoteView } from './types';

const TABS = [
  { value: 'quote', label: '견적 계산기' },
  { value: 'margin', label: '순매출 계산기' },
] as const;

type Tab = (typeof TABS)[number]['value'];

/** 탭 전환 진입: 토큰 조합 fadeUp 4px (Motion 도입 스펙 §3.3 세그먼트 탭 — 프리셋 fadeUp 은 6px 이라 이 자리는 4px 로 조합) */
const TAB_ENTER = { opacity: 0, y: 4 } as const;
const TAB_SHOWN = { opacity: 1, y: 0 } as const;

/**
 * 계산기 화면 탭 (디자인): 견적 계산기 / 순매출 계산기.
 * 탭을 바꾸면 `key` 리마운트로 새 콘텐츠만 fadeUp 진입한다 — 퇴장 애니메이션·`mode="wait"` 없음이라 클릭 즉시 상호작용 가능.
 * 첫 로드(서버 렌더) 콘텐츠는 숨김 initial 을 주지 않는다: 사용자가 탭을 바꾼 뒤부터만 애니메이션한다.
 */
export function CalculatorTabs({
  userId,
  preload,
  savedQuotes,
  canSeeCost,
  initialTab = 'quote',
  initial,
}: {
  /** 현재 사용자 id — 내 견적 목록 표의 열 설정 저장 키 (#32) */
  userId: string;
  preload: readonly FamilyPreload[];
  savedQuotes: readonly SavedQuoteView[];
  canSeeCost: boolean;
  initialTab?: Tab;
  /** 챗봇 견적 시작 링크로 넘어온 제품군·품번 */
  initial?: { family?: string; itemCode?: string };
}) {
  const [{ tab, switched }, setTabState] = useState<{ tab: Tab; switched: boolean }>({
    tab: initialTab,
    switched: false,
  });
  return (
    <div className="flex flex-col gap-6">
      <Segmented
        aria-label="계산기 종류"
        options={TABS}
        value={tab}
        onChange={(next) => setTabState({ tab: next, switched: true })}
        className="w-fit"
      />
      <m.div
        key={tab}
        initial={switched ? TAB_ENTER : false}
        animate={TAB_SHOWN}
        transition={transition.base}
      >
        {tab === 'quote' ? (
          <QuoteCalculator
            userId={userId}
            preload={preload}
            savedQuotes={savedQuotes}
            initial={initial}
          />
        ) : (
          <MarginCalculator canSeeCost={canSeeCost} />
        )}
      </m.div>
    </div>
  );
}
