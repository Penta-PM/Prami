import { cn } from '@/lib/cn';

/**
 * 표 셀 표시 (디자인 가격정책 표): 품목상태 색상 필(R-09, AC-14/22), 운영상태 아이콘+텍스트.
 * 상태는 색상만이 아니라 텍스트로도 구분한다 (§4.8 접근성).
 */
const ITEM_STATUS_CLASSES: Record<string, string> = {
  폐기: 'bg-red-500/12 text-red-500',
  임시: 'bg-[#fdf1de] text-[#a86a00]',
  사용: 'bg-gray-100 text-text-secondary',
  미확인: 'bg-transparent text-text-tertiary shadow-(--hairline-default)',
};

export function ItemStatusPill({ status }: { status: string }) {
  return (
    <span
      data-item-status={status}
      className={cn(
        'inline-flex items-center rounded-pill px-[9px] py-[3px] text-[11px] font-semibold whitespace-nowrap',
        ITEM_STATUS_CLASSES[status] ?? ITEM_STATUS_CLASSES['미확인'],
      )}
    >
      {status}
    </span>
  );
}

/** 운영중 = 파랑 채운 원, 미사용 = 회색 빈 원 (디자인 status-active/inactive 아이콘 대체) */
export function OperationStatus({ status }: { status: '운영중' | '미사용' }) {
  const active = status === '운영중';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] text-[12px] font-semibold whitespace-nowrap',
        active ? 'text-[#3075FF]' : 'text-[#797C85]',
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 shrink-0">
        {active ? (
          <circle cx="7" cy="7" r="5" fill="currentColor" />
        ) : (
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
      {status}
    </span>
  );
}
