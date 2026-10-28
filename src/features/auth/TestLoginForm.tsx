'use client';

import { useState } from 'react';

import { Button, FOCUS_RING_CLASSES } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';

export type TestLoginPreset = { email: string; label: string };

type TestLoginFormProps = {
  action: (formData: FormData) => Promise<void>;
  callbackUrl: string;
  presets: readonly TestLoginPreset[];
};

/** AUTH_TEST_MODE 전용 로그인 (E2E·QA). 픽스처 계정 칩으로 이메일을 채운다 */
export function TestLoginForm({ action, callbackUrl, presets }: TestLoginFormProps) {
  const [email, setEmail] = useState(presets[0]?.email ?? '');

  return (
    <form action={action} aria-label="테스트 계정 로그인" className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.04em] text-text-tertiary">
        <span className="h-px flex-1 bg-border-subtle" />
        테스트 모드
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.email}
            type="button"
            onClick={() => setEmail(preset.email)}
            aria-pressed={email === preset.email}
            className={cn(
              'rounded-pill border-0 bg-surface-muted px-3 py-1.5 text-[12px] font-medium text-text-secondary shadow-(--hairline-subtle) hover:text-text-primary aria-pressed:bg-surface-inverse aria-pressed:text-text-inverse',
              FOCUS_RING_CLASSES,
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text-secondary">이메일</span>
        <Input
          name="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text-secondary">테스트 비밀번호</span>
        <Input name="password" type="password" required autoComplete="current-password" />
      </label>
      <Button type="submit" variant="primary">
        테스트 계정으로 로그인
      </Button>
    </form>
  );
}
