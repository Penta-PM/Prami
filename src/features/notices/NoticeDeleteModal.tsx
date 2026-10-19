'use client';

import { useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Modal } from '@/components/ui';
import type { ActionResult } from '@/lib/result';

import { deleteNoticeAction } from './actions';
import type { NoticeView } from './types';

type NoticeDeleteModalProps = {
  notice: NoticeView;
  onClose: () => void;
  onDone: (result: ActionResult<{ id: string; title: string }>) => void;
};

/** 공지 삭제 확인 (soft delete → 감사 notice.delete) */
export function NoticeDeleteModal({ notice, onClose, onDone }: NoticeDeleteModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const result = await deleteNoticeAction({ id: notice.id });
      if (!result.ok) setError(result.error.message);
      onDone(result);
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="공지 삭제"
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
      <p className="m-0">
        <strong className="text-ink-900">{notice.title}</strong> ({notice.publishedAt} ·{' '}
        {notice.authorName}) 공지를 삭제합니다. 목록과 홈에서 바로 사라지며 감사 로그에 남습니다.
      </p>
      <Presence>
        {error ? (
          <Collapse key="error" role="alert">
            <p className="m-0 mt-3 text-[12px] text-red-500">{error}</p>
          </Collapse>
        ) : null}
      </Presence>
    </Modal>
  );
}
