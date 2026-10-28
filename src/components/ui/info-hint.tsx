'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { LegacyIcon } from '@/features/shell/icons';
import { cn } from '@/lib/cn';

import { Popover, type PopoverAlign } from './popover';

/** 마우스가 버튼·팝오버 영역을 벗어난 뒤 닫기까지 지연(ms) — 버튼 ↔ 팝오버 이동 중 깜빡임 방지 (erp-upload-guide §6.1) */
export const INFO_HINT_LEAVE_DELAY_MS = 200;

export type InfoHintProps = {
  /** 트리거·팝오버의 접근성 이름. 보이는 `text` 가 있으면 그 글자가 이름이 되므로 같은 값을 넘긴다 */
  name: string;
  /** 아이콘 옆에 보이는 글자 (선택) — 예: "PRAMI ERP 데이터". 없으면 아이콘만(이름은 aria-label) */
  text?: ReactNode;
  /** 팝오버 본문 — `aria-describedby` 로 연결되어 열릴 때 낭독된다 */
  children: ReactNode;
  align?: PopoverAlign;
  className?: string;
};

/**
 * 안내 토글팁 (스펙 erp-upload-guide §2-1·§6.1). 앞으로 `title` 툴팁 대신 이 컴포넌트를 표준으로 쓴다.
 *
 * - 트리거: `<button aria-haspopup="dialog" aria-expanded aria-controls>` + 자체 SVG info 아이콘(16px), 터치 영역 24px 이상.
 * - 열기: 클릭·탭·Enter·Space 만. hover 로는 열지 않는다(터치 기기 hover+click 이중 토글 방지).
 * - 닫기: 바깥 클릭·탭, Esc(트리거로 포커스 복귀), Tab 이탈 — Popover 프리미티브 동작.
 *   더해 **마우스(`pointerType === 'mouse'`)가 버튼·팝오버 영역을 벗어나면 200ms 뒤 닫는다** — 그 사이 다시 들어오면 취소.
 *   키보드(Enter·Space → click.detail 0)로 연 경우에는 포인터 이탈로 닫지 않는다. 터치 포인터 이탈도 무시(바깥 탭으로 닫힘).
 *   포커스가 팝오버 안에 있었으면 트리거로 돌려준다.
 * - 팝오버 본문을 `aria-describedby` 로 연결해 열릴 때 스크린리더가 읽는다.
 */
export function InfoHint({ name, text, children, align = 'start', className }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const popoverId = `${baseId}-popover`;
  const bodyId = `${baseId}-body`;
  /** 이번에 키보드로 열었는가 — 그렇다면 포인터 이탈로 닫지 않는다 */
  const keyboardOpenedRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLeave = useCallback(() => {
    if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = null;
  }, []);

  useEffect(() => cancelLeave, [cancelLeave]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) cancelLeave();
      setOpen(next);
    },
    [cancelLeave],
  );

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    cancelLeave();
    // Enter·Space 로 누른 버튼의 click 은 detail 0 (포인터 클릭은 1 이상)
    if (!open) keyboardOpenedRef.current = event.detail === 0;
    setOpen((value) => !value);
  };

  const onPointerEnter = () => cancelLeave();
  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (!open || event.pointerType !== 'mouse' || keyboardOpenedRef.current) return;
    cancelLeave();
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      const panel = document.getElementById(popoverId);
      const focusInside = !!panel && panel.contains(document.activeElement);
      setOpen(false);
      if (focusInside) triggerRef.current?.focus();
    }, INFO_HINT_LEAVE_DELAY_MS);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={text ? undefined : name}
        aria-haspopup="dialog"
        aria-expanded={open}
        // 닫혀 있을 때 팝오버는 DOM 에 없다 — 없는 id 를 가리키지 않게 열렸을 때만 연결
        aria-controls={open ? popoverId : undefined}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className={cn(
          'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent',
          'hover:bg-gray-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          text
            ? 'min-h-8 gap-1.5 px-2 text-[12px] font-semibold text-text-secondary'
            : 'size-6 p-0 text-text-tertiary',
          open && 'bg-gray-100 text-ink-900',
          className,
        )}
      >
        <LegacyIcon name="info" width={16} height={16} className="shrink-0" />
        {text}
      </button>
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={triggerRef}
        label={name}
        align={align}
        id={popoverId}
        describedBy={bodyId}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <div id={bodyId} className="text-[12px] leading-[1.6] text-text-secondary">
          {children}
        </div>
      </Popover>
    </>
  );
}

export type ErpPathHintProps = {
  /** 칸·화면 라벨 — 접근성 이름 "{label} ERP 메뉴 경로" */
  label: string;
  /** 항목명 (굵게) — 예: "가격정책 관리 품목 업데이트" */
  item: string;
  /** ERP 메뉴 경로 원문 — 예: "기본정보 > 품목단가 > 판매단가등록" */
  path: string;
  align?: PopoverAlign;
  className?: string;
};

/** 칸별 ERP 메뉴 경로 ⓘ (erp-upload-guide §2-1 항목 1~4) — 항목명(굵게) + 경로 */
export function ErpPathHint({ label, item, path, ...rest }: ErpPathHintProps) {
  return (
    <InfoHint name={`${label} ERP 메뉴 경로`} {...rest}>
      <span className="flex flex-col gap-1">
        <strong className="font-semibold text-ink-900">{item}</strong>
        {/* 설명 낭독 시 항목명과 경로 사이 띄어 읽기 (flex 안 공백 텍스트는 화면에 그리지 않는다) */}{' '}
        <span>{path}</span>
      </span>
    </InfoHint>
  );
}
