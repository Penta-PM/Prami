'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { Presence } from '@/components/motion/Presence';
import type { ActionResult } from '@/lib/result';

import { NoticeDeleteModal } from './NoticeDeleteModal';
import { NoticeFormModal, type NoticeFormMode } from './NoticeFormModal';
import { ImportantBadge } from './NoticeRows';
import type { NoticeDetailView } from './types';

type NoticesAdminTableProps = { notices: readonly NoticeDetailView[]; defaultAuthor: string };

const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

/** 공지사항 관리 (디자인 "공지사항 관리" 표: 제목·작성일·작성자·중요·관리 + `+ 공지 등록`), ADMIN 전용 */
export function NoticesAdminTable({ notices, defaultAuthor }: NoticesAdminTableProps) {
  const router = useRouter();
  const [form, setForm] = useState<NoticeFormMode | null>(null);
  const [deleting, setDeleting] = useState<NoticeDetailView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const done = (verb: string) => (result: ActionResult<{ id: string; title: string }>) => {
    if (!result.ok) return;
    setForm(null);
    setDeleting(null);
    setFlash(`${verb}했습니다: ${result.data.title}`);
    router.refresh();
  };

  return (
    <>
      <div className="mb-[18px] flex items-center justify-between">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          공지사항 관리
        </h1>
        <Button variant="primary" size="sm" onClick={() => setForm({ kind: 'create' })}>
          + 공지 등록
        </Button>
      </div>
      {flash ? (
        <p
          role="status"
          className="m-0 mb-4 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700"
        >
          {flash}
        </p>
      ) : null}
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <Table aria-label="공지 관리 표">
          <TableHead className="bg-gray-75">
            <TableRow>
              <TableHeaderCell className="pl-5">제목</TableHeaderCell>
              <TableHeaderCell>작성일</TableHeaderCell>
              <TableHeaderCell>작성자</TableHeaderCell>
              <TableHeaderCell className="text-center">중요</TableHeaderCell>
              <TableHeaderCell className="pr-5 text-right">관리</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {notices.map((notice) => (
              <TableRow key={notice.id}>
                <TableCell className="pl-5 font-semibold">
                  <Link href={`/notices/${notice.id}`} className="text-ink-900">
                    {notice.title}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-tertiary">
                  {notice.publishedAt}
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {notice.authorName}
                </TableCell>
                <TableCell className="text-center">
                  {notice.isImportant ? <ImportantBadge /> : '—'}
                </TableCell>
                <TableCell className="pr-5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`${notice.title} 수정`}
                    className={`${ACTION} text-purple-600`}
                    onClick={() => setForm({ kind: 'edit', notice })}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    aria-label={`${notice.title} 삭제`}
                    className={`${ACTION} text-red-500`}
                    onClick={() => setDeleting(notice)}
                  >
                    삭제
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {notices.length === 0 ? (
          <p className="m-0 p-12 text-center text-[13px] text-text-tertiary">
            등록된 공지가 없습니다.
          </p>
        ) : null}
      </div>
      <Presence>
        {form ? (
          <NoticeFormModal
            mode={form}
            defaultAuthor={defaultAuthor}
            onClose={() => setForm(null)}
            onDone={done(form.kind === 'edit' ? '수정' : '등록')}
          />
        ) : null}
      </Presence>
      <Presence>
        {deleting ? (
          <NoticeDeleteModal
            notice={deleting}
            onClose={() => setDeleting(null)}
            onDone={done('삭제')}
          />
        ) : null}
      </Presence>
    </>
  );
}
