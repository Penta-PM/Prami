'use client';

import { useState, useTransition } from 'react';

import { Button, Modal } from '@/components/ui';
import type { ActionResult } from '@/lib/result';
import type { BidKeywordView } from '@/server/procurement/keywords';

import { deleteBidKeywordAction } from './actions';

type KeywordDeleteModalProps = {
  keyword: BidKeywordView;
  onClose: () => void;
  /** 삭제됨 또는 이미 처리됨(CONFLICT) — 패널이 안내하고 새로 불러온다. 그 밖의 오류는 모달 안에 보여 준다 */
  onDone: (result: ActionResult<BidKeywordView>) => void;
};

/** 키워드 삭제 확인 (Prami 확인 모달 — confirm 금지). 삭제와 감사 procurement.keyword.delete 는 같은 트랜잭션 */
export function KeywordDeleteModal({ keyword, onClose, onDone }: KeywordDeleteModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const excluded = keyword.product === '제외';

  const remove = () =>
    startTransition(async () => {
      const result = await deleteBidKeywordAction({ id: keyword.id });
      if (result.ok || result.error.code === 'CONFLICT') {
        onDone(result);
        return;
      }
      setError(result.error.message);
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="키워드 삭제"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" variant="danger" disabled={isPending} onClick={remove}>
            삭제
          </Button>
        </>
      }
    >
      <p className="m-0 break-keep">
        <strong className="text-ink-900">{keyword.keyword}</strong>{' '}
        {excluded ? '제외 단어' : '키워드'}를 삭제할까요?{' '}
        {excluded
          ? '다음 수집부터 이 단어가 들어간 공고도 버리지 않습니다.'
          : `다음 수집부터 이 키워드로는 ${keyword.product} 공고를 모으지 않습니다.`}{' '}
        삭제는 감사 로그에 남습니다.
      </p>
      {error ? (
        <p role="alert" className="m-0 mt-3 text-[12px] text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
