'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';
import { formatMillionWon, formatShare, millionWonHeader } from '@/lib/procurement/format';

import { TONE_TEXT } from './KpiCards';
import {
  isRowHighlighted,
  summarizeManufacturerRows,
  yoyText,
  type ManufacturerTableRow,
} from './model';

export type ManufacturerTableProps = {
  /** 기간 실적 행 (금액 큰 순, 자사 포함 — manufacturerTableRows) */
  rows: readonly ManufacturerTableRow[];
  /** 기간 합계 */
  total: number;
  /** 강조 중인 제조사 키 (차트 범례와 공유) */
  highlight: string | null;
  /** 차트 계열 키 — 차트에서 "기타" 로 묶인 행 판정 */
  chartKeys: ReadonlySet<string>;
  onToggleHighlight: (key: string) => void;
};

const TH =
  'border-b border-border-default px-2 py-1.5 text-[13px] font-bold whitespace-nowrap text-text-secondary';
const TD = 'px-2 py-1.5 text-right text-[13px] whitespace-nowrap text-text-primary tabular-nums';
const TOTAL = 'border-t-2 border-border-default';
const NAME_BUTTON =
  'max-w-full truncate border-0 bg-transparent p-0 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500';

/**
 * 제조사별 실적 (원본 ManufacturerTable — 누적매출/점유율/전년대비 한 표): 평소엔 1~4위(자사 포함) + "기타 N개사"(누르면 펼침),
 * 펼치면 전 제조사. 제조사 이름을 누르면 차트에서 그 계열을 강조하고(다시 누르면 해제) 범례와 상태를 공유한다.
 * 강조한 회사가 "기타" 안에 있으면 자동으로 펼친다. 표 금액 = 백만원(D-3), 표는 칸 안에서만 가로 스크롤.
 */
export function ManufacturerTable({
  rows,
  total,
  highlight,
  chartKeys,
  onToggleHighlight,
}: ManufacturerTableProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeManufacturerRows(rows);
  const highlighted = (key: string) => isRowHighlighted(key, highlight, chartKeys);
  const hiddenHighlight =
    !summary.some((row) => highlighted(row.key)) && rows.some((row) => highlighted(row.key));
  const showAll = expanded || hiddenHighlight;
  const shown = showAll ? rows : summary;
  const canExpand = summary.some((row) => row.isEtc);

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table
        aria-label="제조사별 실적"
        className="w-full min-w-[360px] table-fixed border-collapse"
        data-testid="manufacturer-table"
      >
        <colgroup>
          <col />
          <col className="w-[100px]" />
          <col className="w-[64px]" />
          <col className="w-[72px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={cn(TH, 'text-left')}>
              제조사
            </th>
            <th scope="col" className={cn(TH, 'text-right whitespace-normal')}>
              {millionWonHeader('누적매출')}
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              점유율
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              전년대비
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-2 py-2.5 text-center text-[13px] text-text-tertiary">
                실적 없음
              </td>
            </tr>
          ) : (
            shown.map((row) => {
              const isHi = highlighted(row.key);
              const yoy = yoyText(row.amount, row.previousAmount);
              return (
                <tr
                  key={row.key}
                  data-manufacturer-row={row.key}
                  data-highlighted={isHi || undefined}
                  className={cn(
                    isHi
                      ? 'bg-surface-muted outline outline-1 -outline-offset-1 outline-border-default'
                      : row.isOurs
                        ? 'bg-accent-ours/[0.08]'
                        : undefined,
                  )}
                >
                  <th scope="row" className="relative max-w-0 px-2 py-1.5 text-left font-normal">
                    {row.isEtc ? (
                      <button
                        type="button"
                        aria-expanded={false}
                        onClick={() => setExpanded(true)}
                        title="눌러서 전체 제조사 보기"
                        className={cn(NAME_BUTTON, 'font-medium text-text-secondary')}
                      >
                        {row.label}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={isHi}
                        onClick={() => onToggleHighlight(row.key)}
                        title={row.manufacturer ?? row.label}
                        className={cn(
                          NAME_BUTTON,
                          row.isOurs ? 'font-bold text-accent-ours' : 'text-text-primary',
                          isHi && 'font-bold',
                        )}
                      >
                        {row.label}
                        {row.isOurs ? <span className="sr-only"> (자사)</span> : null}
                      </button>
                    )}
                  </th>
                  <td className={TD}>{formatMillionWon(row.amount)}</td>
                  <td className={TD}>{formatShare(total > 0 ? row.amount / total : null)}</td>
                  <td className={cn(TD, yoy.tone ? TONE_TEXT[yoy.tone] : 'text-text-tertiary')}>
                    {yoy.text}
                  </td>
                </tr>
              );
            })
          )}
          {canExpand && (
            <tr>
              <td colSpan={4} className="px-2 py-2.5 text-center">
                <button
                  type="button"
                  aria-expanded={showAll}
                  onClick={() => {
                    if (showAll) {
                      setExpanded(false);
                      // 기타 안에 숨을 회사가 강조돼 있으면 강조도 풀어야 접힌다 (원본)
                      if (hiddenHighlight && highlight) onToggleHighlight(highlight);
                    } else setExpanded(true);
                  }}
                  className="rounded-pill border border-border-default bg-transparent px-3.5 py-1 text-[12px] font-semibold text-text-secondary hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
                >
                  {showAll ? '접기 ▴' : `전체 ${rows.length}개사 펼치기 ▾`}
                </button>
              </td>
            </tr>
          )}
          {rows.length > 0 && (
            <tr>
              <th scope="row" className={cn(TOTAL, 'px-2 py-1.5 text-left text-[13px] font-bold')}>
                합계
              </th>
              <td className={cn(TD, TOTAL, 'font-bold')}>{formatMillionWon(total)}</td>
              <td className={cn(TD, TOTAL, 'font-bold')}>100%</td>
              <td className={cn(TD, TOTAL, 'font-bold')}>-</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
