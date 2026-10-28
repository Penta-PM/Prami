import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

import { densityAttrs } from './density';

/**
 * 표 프리미티브. 가로 스크롤 래퍼를 포함한다.
 * 표는 밀집 컨테이너(Q-D1 = B) — 래퍼가 `data-density="sm"` 이라 칸 안의 공용 컨트롤은 36·14, 본문 글자 BodySmall 14
 */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div {...densityAttrs('sm')} className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[14px]', className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('text-left', className)} {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

/** 행 hover 배경은 본문 행에만 — thead 안의 TableRow 에는 붙지 않는다 (#32 스펙 §4) */
export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border-subtle last:border-b-0 hover:bg-gray-75 [thead_&]:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

export function TableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2.5 text-[12px] font-semibold whitespace-nowrap text-text-tertiary',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-3 align-middle text-ink-900', className)} {...props} />;
}
