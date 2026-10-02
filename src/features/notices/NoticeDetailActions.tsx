'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui';
import type { ActionResult } from '@/lib/result';

import { NoticeDeleteModal } from './NoticeDeleteModal';
import { NoticeFormModal } from './NoticeFormModal';
import type { NoticeDetailView } from './types';

/** 공지 상세의 ADMIN 전용 수정/삭제 (디자인 상세 하단). USER 에게는 렌더하지 않는다 (AC-51) */
export function NoticeDetailActions({
  notice,
  defaultAuthor,
}: {
  notice: NoticeDetailView;
  defaultAuthor: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const onEdited = (result: ActionResult<{ id: string; title: string }>) => {
    if (!result.ok) return;
    setEditing(false);
    setFlash('수정했습니다');
    router.refresh();
  };
  const onDeleted = (result: ActionResult<{ id: string; title: string }>) => {
    if (!result.ok) return;
    router.push('/notices');
  };

  return (
    <div className="mt-7 flex items-center gap-2 border-t border-border-subtle pt-5">
      <Button size="sm" onClick={() => setEditing(true)}>
        수정
      </Button>
      <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
        삭제
      </Button>
      {flash ? (
        <span role="status" className="text-[12px] text-green-700">
          {flash}
        </span>
      ) : null}
      {editing ? (
        <NoticeFormModal
          mode={{ kind: 'edit', notice }}
          defaultAuthor={defaultAuthor}
          onClose={() => setEditing(false)}
          onDone={onEdited}
        />
      ) : null}
      {deleting ? (
        <NoticeDeleteModal notice={notice} onClose={() => setDeleting(false)} onDone={onDeleted} />
      ) : null}
    </div>
  );
}
