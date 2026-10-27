'use client';

import { useState } from 'react';

/** 제어/비제어 겸용 상태 — value 가 undefined 면 내부 상태, 아니면 호출자 값(onChange 로 알린다) */
export function useControllable<T>(
  value: T | undefined,
  onChange: ((next: T) => void) | undefined,
  initial: T,
): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(initial);
  const controlled = value !== undefined;
  return [
    controlled ? value : inner,
    (next: T) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
  ];
}

/** 숨긴 계열 집합 토글 */
export function useHiddenKeys(): [ReadonlySet<string>, (key: string) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  return [
    hidden,
    (key: string) =>
      setHidden((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
  ];
}
