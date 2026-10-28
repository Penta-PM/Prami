import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '@/lib/cn';

import { controlSizeClasses, type ControlSize } from './density';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** 입력창 왼쪽에 겹쳐 표시할 아이콘 */
  leading?: ReactNode;
  wrapperClassName?: string;
  /** sm 36·14 / md 44·16. 주지 않으면 가장 가까운 `data-density` 컨테이너를 따른다 (./density.tsx) */
  size?: ControlSize;
  /** React 19 — 함수 컴포넌트도 ref 를 prop 으로 받는다 (챗봇 이름 바꾸기·질문 입력 포커스) */
  ref?: Ref<HTMLInputElement>;
};

/**
 * 입력창·Select 공통 (Penta §6 Input): 흰 바탕 · 1px N200 테두리 · 반경 8 · 좌우 12 · 자리표시 N600(AA).
 * 포커스는 테두리 P500 + 2px --focus-ring 고리(키보드·마우스 모두 — 글 입력칸은 항상 focus-visible).
 */
export const FIELD_CLASSES = cn(
  'w-full rounded-control border border-solid border-neutral-200 bg-neutral-0 text-text-primary',
  'focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus-ring',
  'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-text-secondary',
);

/** 텍스트 입력 */
export function Input({ leading, className, wrapperClassName, size, ...props }: InputProps) {
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      {leading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 text-text-tertiary"
        >
          {leading}
        </span>
      ) : null}
      <input
        className={cn(
          FIELD_CLASSES,
          controlSizeClasses(size),
          'placeholder:text-text-placeholder',
          leading ? 'pr-3 pl-10' : 'px-3',
          className,
        )}
        {...props}
      />
    </div>
  );
}
