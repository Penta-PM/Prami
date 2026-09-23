import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/cn';

describe('cn', () => {
  it('조건부 클래스를 합친다', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });

  it('충돌하는 Tailwind 클래스는 뒤가 우선한다', () => {
    expect(cn('px-3 text-[12px]', 'px-4')).toBe('text-[12px] px-4');
  });
});
