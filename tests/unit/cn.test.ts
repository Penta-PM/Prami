import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/cn';

describe('cn', () => {
  it('조건부 클래스를 합친다', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });

  it('충돌하는 Tailwind 클래스는 뒤가 우선한다', () => {
    expect(cn('px-3 text-[12px]', 'px-4')).toBe('text-[12px] px-4');
  });

  it('앱 반경·그림자 이름(rounded-card·shadow-modal …)도 기본 크기 이름과 충돌로 병합한다 (Penta PR-2)', () => {
    expect(cn('rounded-card shadow-card', 'rounded-2xl shadow-none')).toBe(
      'rounded-2xl shadow-none',
    );
    expect(cn('rounded-lg', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('shadow-(--shadow-elevated)', 'shadow-modal')).toBe('shadow-modal');
  });
});
