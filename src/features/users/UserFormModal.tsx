'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Input, Modal, Select } from '@/components/ui';
import type { ActionResult } from '@/lib/result';

import { createUserAction, updateUserAction } from './actions';
import type { UserRow } from './UsersTable';

export type UserFormMode = { kind: 'create' } | { kind: 'edit'; user: UserRow };

type UserFormModalProps = {
  mode: UserFormMode;
  error: string | null;
  onClose: () => void;
  onDone: (result: ActionResult<unknown>) => void;
};

/**
 * 사용자 추가(이메일 사전 등록) / 수정 모달 (§4.5.10).
 * 사전 등록한 이메일로 Google 로그인하면 이름·google_sub·아바타가 채워진다.
 */
export function UserFormModal({ mode, error, onClose, onDone }: UserFormModalProps) {
  const editing = mode.kind === 'edit' ? mode.user : null;
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? '');
    const role = text('role') === 'ADMIN' ? 'ADMIN' : 'USER';
    startTransition(async () => {
      const result = editing
        ? await updateUserAction({
            id: editing.id,
            name: text('name'),
            department: text('department'),
            role,
            status: text('status') === 'inactive' ? 'inactive' : 'active',
          })
        : await createUserAction({
            email: text('email'),
            name: text('name'),
            department: text('department'),
            role,
          });
      setFieldErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
      onDone(result);
    });
  };

  const formId = editing ? 'user-edit-form' : 'user-create-form';

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? '사용자 수정' : '사용자 추가'}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" variant="primary" type="submit" form={formId} disabled={isPending}>
            저장
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3.5">
        <Presence>
          {error ? (
            <Collapse key="error" role="alert">
              <p className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-500">
                {error}
              </p>
            </Collapse>
          ) : null}
        </Presence>
        <Field label="이메일" error={fieldErrors.email}>
          <Input
            name="email"
            type="email"
            required={!editing}
            disabled={Boolean(editing)}
            defaultValue={editing?.email}
            placeholder="name@pentasecurity.com"
          />
        </Field>
        <Field
          label={editing ? '이름' : '이름 (선택 — 첫 로그인 시 Google 프로필로 채워짐)'}
          error={fieldErrors.name}
        >
          <Input name="name" required={Boolean(editing)} defaultValue={editing?.name} />
        </Field>
        <Field label="부서" error={fieldErrors.department}>
          <Input name="department" defaultValue={editing?.department ?? ''} />
        </Field>
        <Field label="역할" error={fieldErrors.role}>
          <Select name="role" defaultValue={editing?.role ?? 'USER'}>
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </Select>
        </Field>
        {editing ? (
          <Field label="상태" error={fieldErrors.status}>
            <Select name="status" defaultValue={editing.status}>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
            </Select>
          </Field>
        ) : null}
        <p className="m-0 text-[11px] text-text-tertiary">
          역할·상태 변경은 감사 로그에 변경 전/후 값으로 기록됩니다.
        </p>
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
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
      {error?.length ? <span className="text-[12px] text-red-500">{error.join(' ')}</span> : null}
    </label>
  );
}
