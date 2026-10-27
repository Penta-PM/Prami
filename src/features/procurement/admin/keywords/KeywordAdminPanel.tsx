'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card } from '@/components/ui';
import { BID_KEYWORD_GROUPS, type BidKeywordGroup } from '@/lib/procurement/keywords';
import type { ActionResult } from '@/lib/result';
import type { BidKeywordBoard, BidKeywordView } from '@/server/procurement/keywords';

import { formatCollectedAt } from '../../ProcurementHeader';
import { addBidKeywordAction } from './actions';
import { KeywordDeleteModal } from './KeywordDeleteModal';
import { KeywordGroupRow, type KeywordAddOutcome } from './KeywordGroupRow';

/** 마지막 확인 기록이 없을 때 */
export const NO_LAST_CHECKED_TEXT = '확인 기록 없음';

/**
 * 키워드 관리 탭 (조달이 통합 UI-8 — 원본 KeywordPanel 구조): 제품별·"제외 단어" 그룹 칩 편집기 + 마지막 확인 시각.
 * 목록은 RSC(KeywordsAdminSection)가 서버에서 읽어 `board` 로 넘긴다. 추가·삭제 뒤에는 router.refresh() 로 다시 읽는다.
 * 동시 편집: 서버가 CONFLICT("이미 처리됨")를 돌려주면 안내(role=status) 후 새로 불러온다.
 */
export function KeywordAdminPanel({ board }: { board: BidKeywordBoard }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BidKeywordView | null>(null);

  const add = async (product: BidKeywordGroup, keyword: string): Promise<KeywordAddOutcome> => {
    const result = await addBidKeywordAction({ product, keyword });
    if (result.ok) {
      setNotice(`추가했습니다: ${result.data.keyword}`);
      router.refresh();
      return { clear: true };
    }
    if (result.error.code === 'CONFLICT') {
      setNotice(`${result.error.message} — 목록을 새로 불러왔습니다`);
      router.refresh();
      return { clear: true };
    }
    if (result.error.code === 'VALIDATION') {
      return {
        clear: false,
        error: result.error.fieldErrors?.keyword?.[0] ?? result.error.message,
      };
    }
    setNotice(null);
    return { clear: false, error: result.error.message };
  };

  const deleted = (result: ActionResult<BidKeywordView>) => {
    setPendingDelete(null);
    setNotice(
      result.ok
        ? `삭제했습니다: ${result.data.keyword}`
        : `${result.error.message} — 목록을 새로 불러왔습니다`,
    );
    router.refresh();
  };

  const lastCheckedAt = board.lastCheckedAt ? new Date(board.lastCheckedAt) : null;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[15px] font-bold text-ink-900">분류 키워드</h2>
        <p className="m-0 text-[12px] text-text-tertiary">
          <span className="font-semibold">마지막 확인</span>{' '}
          <span className="tabular-nums" data-testid="procurement-keywords-last-checked">
            {lastCheckedAt ? (
              <time dateTime={lastCheckedAt.toISOString()}>{formatCollectedAt(lastCheckedAt)}</time>
            ) : (
              NO_LAST_CHECKED_TEXT
            )}
          </span>
        </p>
      </div>
      <p className="m-0 text-[13px] leading-relaxed break-keep text-text-tertiary">
        공고명에 이 단어가 들어가면 그 제품 공고로 모읍니다. 제외 단어가 들어간 공고는 버립니다.
        바꾼 키워드는 다음 수집부터 반영됩니다.
      </p>
      <p role="status" className="m-0 min-h-[1em] text-[12px] text-text-secondary">
        {notice}
      </p>
      <div className="flex flex-col gap-3">
        {BID_KEYWORD_GROUPS.map((group) => (
          <KeywordGroupRow
            key={group.key}
            group={group}
            keywords={board.keywords.filter((row) => row.product === group.key)}
            onAdd={(keyword) => add(group.key, keyword)}
            onRequestDelete={setPendingDelete}
          />
        ))}
      </div>
      <p className="m-0 text-[12px] text-text-tertiary">
        테두리가 있는 키워드는 직접 추가한 것입니다. 키워드에 마우스를 올리면 누가 넣었는지
        보입니다.
      </p>
      {pendingDelete ? (
        <KeywordDeleteModal
          keyword={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onDone={deleted}
        />
      ) : null}
    </Card>
  );
}
