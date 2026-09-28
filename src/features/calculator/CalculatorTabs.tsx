'use client';

import { useState } from 'react';

import { Segmented } from '@/components/ui';

import { MarginCalculator } from './MarginCalculator';
import { QuoteCalculator } from './QuoteCalculator';
import type { FamilyPreload, SavedQuoteView } from './types';

const TABS = [
  { value: 'quote', label: '견적 계산기' },
  { value: 'margin', label: '순매출 계산기' },
] as const;

type Tab = (typeof TABS)[number]['value'];

/** 계산기 화면 탭 (디자인): 견적 계산기 / 순매출 계산기 */
export function CalculatorTabs({
  preload,
  savedQuotes,
  canSeeCost,
  initialTab = 'quote',
  initial,
}: {
  preload: readonly FamilyPreload[];
  savedQuotes: readonly SavedQuoteView[];
  canSeeCost: boolean;
  initialTab?: Tab;
  /** 챗봇 견적 시작 링크로 넘어온 제품군·품번 */
  initial?: { family?: string; itemCode?: string };
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="flex flex-col gap-6">
      <Segmented
        aria-label="계산기 종류"
        options={TABS}
        value={tab}
        onChange={setTab}
        className="w-fit"
      />
      {tab === 'quote' ? (
        <QuoteCalculator preload={preload} savedQuotes={savedQuotes} initial={initial} />
      ) : (
        <MarginCalculator canSeeCost={canSeeCost} />
      )}
    </div>
  );
}
