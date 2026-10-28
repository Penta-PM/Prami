import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { controlSizeClasses, type ControlSize } from './density';
import { FIELD_CLASSES } from './input';

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  /** sm 36·14 / md 44·16. 주지 않으면 가장 가까운 `data-density` 컨테이너를 따른다 (./density.tsx) */
  size?: ControlSize;
};

/** 네이티브 select. Input 과 같은 Penta 입력창 스타일 (오른쪽은 네이티브 화살표 자리 32) */
export function Select({ className, size, ...props }: SelectProps) {
  return (
    <select
      className={cn(FIELD_CLASSES, controlSizeClasses(size), 'pr-8 pl-3', className)}
      {...props}
    />
  );
}
