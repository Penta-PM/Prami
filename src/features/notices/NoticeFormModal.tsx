'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Checkbox, Input, Modal } from '@/components/ui';
import { FIELD_CLASSES } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { ActionResult } from '@/lib/result';

import { upsertNoticeAction } from './actions';
import type { NoticeDetailView } from './types';

export type NoticeFormMode = { kind: 'create' } | { kind: 'edit'; notice: NoticeDetailView };

type NoticeFormModalProps = {
  mode: NoticeFormMode;
  /** 기본 작성자 (세션 사용자 이름) */
  defaultAuthor: string;
  onClose: () => void;
  onDone: (result: ActionResult<{ id: string; title: string }>) => void;
};

const FIELD_CLASS = 'flex flex-col gap-1.5';
const LABEL_CLASS = 'text-[12px] font-medium text-text-secondary';
/** 여러 줄 입력 — Input 과 같은 필드 표면(FIELD_CLASSES: 흰 바탕·N200 테두리·포커스 고리) + 폼 밀도 md(Body 16) */
const TEXTAREA_CLASS = cn(
  FIELD_CLASSES,
  'resize-y px-3 py-3 text-[16px] leading-[1.7] placeholder:text-text-placeholder',
);

/** 공지 등록/수정 (디자인 "공지사항 등록/수정": 제목·작성자·내용·중요 공지로 표시) → 감사 notice.create|update */
export function NoticeFormModal({ mode, defaultAuthor, onClose, onDone }: NoticeFormModalProps) {
  const editing = mode.kind === 'edit' ? mode.notice : null;
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? '');
    startTransition(async () => {
      const result = await upsertNoticeAction({
        ...(editing ? { id: editing.id } : {}),
        title: text('title'),
        authorName: text('authorName'),
        body: text('body'),
        isImportant: data.get('isImportant') === 'on',
        publishedAt: text('publishedAt'),
      });
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
      }
      onDone(result);
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? '공지 수정' : '공지 등록'}
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" type="submit" form="notice-form" disabled={isPending}>
            저장
          </Button>
        </>
      }
    >
      <form id="notice-form" onSubmit={submit} className="flex flex-col gap-4">
        <Presence>
          {error ? (
            <Collapse key="error" role="alert">
              <p className="m-0 rounded-lg bg-surface-danger px-3 py-2.5 text-[14px] text-text-danger">
                {error}
              </p>
            </Collapse>
          ) : null}
        </Presence>
        <Field label="제목" error={fieldErrors.title}>
          <Input name="title" defaultValue={editing?.title ?? ''} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="작성자" error={fieldErrors.authorName}>
            <Input name="authorName" defaultValue={editing?.authorName ?? defaultAuthor} />
          </Field>
          <Field label="작성일" error={fieldErrors.publishedAt}>
            <Input name="publishedAt" type="date" defaultValue={editing?.publishedAt ?? ''} />
          </Field>
        </div>
        <Field label="내용" error={fieldErrors.body}>
          <textarea
            name="body"
            rows={10}
            defaultValue={editing?.body ?? ''}
            className={TEXTAREA_CLASS}
          />
        </Field>
        <label className="flex items-center gap-2 text-[14px] font-medium">
          <Checkbox name="isImportant" defaultChecked={editing?.isImportant ?? false} />
          중요 공지로 표시
        </label>
      </form>
    </Modal>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className={FIELD_CLASS}>
      <span className={LABEL_CLASS}>{label}</span>
      {children}
      {error?.length ? (
        <span className="text-[12px] text-text-danger">{error.join(' ')}</span>
      ) : null}
    </label>
  );
}
