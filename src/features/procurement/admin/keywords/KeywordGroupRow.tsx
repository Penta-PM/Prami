'use client';

import { useId, useState, useTransition, type KeyboardEvent } from 'react';

import { Icon } from '@/components/icons/Icon';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { checkBidKeyword, type BID_KEYWORD_GROUPS } from '@/lib/procurement/keywords';
import type { BidKeywordView } from '@/server/procurement/keywords';

/** 추가 결과 — clear: 입력을 비운다(추가됨·이미 처리됨), error: 입력 아래 안내 */
export type KeywordAddOutcome = { clear: boolean; error?: string };

type KeywordGroupRowProps = {
  group: (typeof BID_KEYWORD_GROUPS)[number];
  keywords: readonly BidKeywordView[];
  onAdd: (keyword: string) => Promise<KeywordAddOutcome>;
  onRequestDelete: (keyword: BidKeywordView) => void;
};

/**
 * 한 그룹(제품 또는 제외)의 칩 편집기: 칩마다 × 삭제 버튼(접근 이름 "{키워드} 삭제" — 확인 모달은 패널),
 * 입력 + Enter(한글 조합 중 Enter 는 무시)/추가 버튼. 입력 검사(빈 값·길이·제어 문자·그룹 안 중복)는 서버와 같은 규칙.
 */
export function KeywordGroupRow({ group, keywords, onAdd, onRequestDelete }: KeywordGroupRowProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const headingId = useId();
  const errorId = useId();
  const excluded = group.key === '제외';

  const submit = () => {
    if (isPending || !draft.trim()) return;
    const checked = checkBidKeyword(
      draft,
      keywords.map((row) => row.keyword),
    );
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    startTransition(async () => {
      const outcome = await onAdd(checked.keyword);
      if (outcome.clear) setDraft('');
      setError(outcome.error ?? null);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-2 border-t border-border-subtle pt-3 sm:flex-row sm:gap-3"
    >
      <div className="flex shrink-0 items-baseline gap-2 sm:w-28 sm:flex-col sm:gap-0.5 sm:pt-1">
        <h3 id={headingId} className="m-0 text-[13px] font-bold text-ink-900">
          {group.label}
        </h3>
        <span className="text-[12px] text-text-tertiary tabular-nums">{keywords.length}개</span>
        {group.note ? (
          <span className="text-[12px] break-keep text-text-tertiary">{group.note}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {keywords.length > 0 ? (
          <ul
            aria-label={`${group.label} 키워드`}
            className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0"
          >
            {keywords.map((row) => (
              <li
                key={row.id}
                title={row.addedBy ? `추가: ${row.addedBy}` : '기본 키워드'}
                data-manual={row.addedBy ? '' : undefined}
                className={cn(
                  'inline-flex max-w-full items-center gap-0.5 rounded-pill py-1 pr-1 pl-2.5 text-[13px] font-semibold',
                  excluded ? 'bg-gray-100 text-text-secondary' : 'bg-purple-500/12 text-purple-600',
                  row.addedBy && 'shadow-[inset_0_0_0_1px_var(--purple-500)]',
                )}
              >
                <span className="min-w-0 break-all">{row.keyword}</span>
                <button
                  type="button"
                  aria-label={`${row.keyword} 삭제`}
                  title="삭제"
                  onClick={() => onRequestDelete(row)}
                  className="hover:bg-black/5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-pill border-0 bg-transparent p-0 text-text-tertiary hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-purple-500"
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[12px] text-text-tertiary">키워드 없음</span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <Input
            value={draft}
            placeholder={group.placeholder}
            aria-label={`${group.label} ${excluded ? '' : '키워드 '}추가`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            wrapperClassName="w-36"
            className="py-1.5"
          />
          <Button size="sm" disabled={isPending || !draft.trim()} onClick={submit}>
            추가
          </Button>
        </span>
        {error ? (
          <p id={errorId} role="alert" className="m-0 w-full text-[12px] text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
