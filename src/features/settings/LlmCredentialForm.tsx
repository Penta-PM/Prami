'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui';

import { COMPANY_KEY_FORM_HINT } from './labels';

/**
 * API 키 입력 (PRAMI-002 §4.6.1 ②, T-10·AC-213): password 필드, autocomplete off, spellcheck off.
 * 제출하면 입력값을 **즉시 비우고** 컴포넌트 상태에 보관하지 않는다 — 값은 폼 제출 순간에만 읽는다(비제어 입력).
 */
export function LlmCredentialForm({
  vendorId,
  vendorLabel,
  replacing,
  disabled,
  onSubmit,
  onCancel,
}: {
  vendorId: string;
  vendorLabel: string;
  replacing: boolean;
  disabled: boolean;
  onSubmit: (apiKey: string) => Promise<void>;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const inputId = `llm-key-${vendorId}`;
  const hintId = `llm-key-hint-${vendorId}`;

  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-gray-75 p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        const value = input.value;
        input.value = '';
        setPending(true);
        try {
          await onSubmit(value);
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor={inputId} className="text-[12px] font-semibold text-text-secondary">
        {vendorLabel} API 키 {replacing ? '교체' : '등록'}
      </label>
      {/* 회사 키 주의 힌트 (PRAMI-003 §4.8.2 ②) — 입력란이 aria-describedby 로 가리킨다 */}
      <p id={hintId} className="m-0 text-[12px] break-keep text-text-danger">
        {COMPANY_KEY_FORM_HINT}
      </p>
      <input
        id={inputId}
        aria-describedby={hintId}
        ref={inputRef}
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        required
        minLength={16}
        maxLength={256}
        placeholder="키를 붙여넣으세요 — 저장 후 다시 볼 수 없습니다"
        className="rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)]"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={disabled || pending}>
          {pending ? '저장 중…' : '저장하고 검증'}
        </Button>
        <Button type="button" size="sm" onClick={onCancel} disabled={pending}>
          취소
        </Button>
      </div>
    </form>
  );
}
