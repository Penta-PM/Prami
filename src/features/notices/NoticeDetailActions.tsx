'use client';

import { m } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import { fade } from '@/lib/motion/tokens';
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
      <Button onClick={() => setEditing(true)}>수정</Button>
      <Button variant="danger" onClick={() => setDeleting(true)}>
        삭제
      </Button>
      <Presence>
        {flash ? (
          <m.span
            key="flash"
            role="status"
            variants={fade}
            initial="initial"
            animate="animate"
            exit="exit"
            className="text-[12px] text-success-700"
          >
            {flash}
          </m.span>
        ) : null}
      </Presence>
      <Presence>
        {editing ? (
          <NoticeFormModal
            mode={{ kind: 'edit', notice }}
            defaultAuthor={defaultAuthor}
            onClose={() => setEditing(false)}
            onDone={onEdited}
          />
        ) : null}
      </Presence>
      <Presence>
        {deleting ? (
          <NoticeDeleteModal
            notice={notice}
            onClose={() => setDeleting(false)}
            onDone={onDeleted}
          />
        ) : null}
      </Presence>
    </div>
  );
}
