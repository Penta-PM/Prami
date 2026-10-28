'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';

import { Button, densityAttrs, FOCUS_RING_CLASSES, Input, Modal } from '@/components/ui';
import { CHAT_TITLE_EMPTY_MESSAGE, CHAT_TITLE_MAX } from '@/lib/chat/conversations';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime } from '@/lib/date-format';

import { DELETE_WARNING, LIST_LOAD_ERROR, UNTITLED_CONVERSATION } from './copy';
import type { ListStatus } from './useConversationList';
import type { ConversationSummary } from './types';

/**
 * 저장 대화 목록 (UX PR-C2 §4.2): 최근 순, 제목 + 상대 시각, 선택 행 aria-current. 행 ⋯ 메뉴 "이름 바꾸기"(제자리 입력 —
 * Enter 저장·Esc 취소·바깥으로 포커스가 나가면 취소) · "삭제"(Penta 확인 모달 — 되돌릴 수 없음 안내).
 * 밀도: 목록 행·메뉴·이름 입력은 밀집 컨테이너(sm), "새 대화"는 독립 주요 버튼(md) — Q-D1.
 * 포커스: 이름 바꾸기 뒤 그 행, 삭제 뒤 다음 행(없으면 이전 행, 목록이 비면 "새 대화").
 */
export type ConversationListProps = {
  items: readonly ConversationSummary[];
  status: ListStatus;
  selectedId: string | null;
  hrefFor: (id: string) => string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRetry: () => void;
  onRename: (id: string, title: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onDelete: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  newButtonRef: RefObject<HTMLButtonElement | null>;
};

type FocusTarget = { kind: 'row'; id: string } | { kind: 'new' } | null;

const displayTitle = (item: ConversationSummary) => item.title ?? UNTITLED_CONVERSATION;

export function ConversationList({
  items,
  status,
  selectedId,
  hrefFor,
  onSelect,
  onNew,
  onRetry,
  onRename,
  onDelete,
  newButtonRef,
}: ConversationListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConversationSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);

  // 이름 바꾸기·삭제 뒤 포커스 — 모달이 닫히며 트리거(사라진 메뉴 항목)로 돌려주지 못하므로 다음 프레임에 옮긴다
  useEffect(() => {
    if (!focusTarget) return;
    const frame = requestAnimationFrame(() => {
      if (focusTarget.kind === 'new') newButtonRef.current?.focus();
      else
        listRef.current
          ?.querySelector<HTMLElement>(`[data-conversation-id="${focusTarget.id}"] a`)
          ?.focus();
      setFocusTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTarget, newButtonRef]);

  const confirmDelete = async () => {
    if (!confirming) return;
    const index = items.findIndex((item) => item.id === confirming.id);
    const neighbour = items[index + 1] ?? items[index - 1] ?? null;
    setDeleting(true);
    setDeleteError(null);
    const result = await onDelete(confirming.id);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.message);
      return;
    }
    setConfirming(null);
    setFocusTarget(neighbour ? { kind: 'row', id: neighbour.id } : { kind: 'new' });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border-subtle p-3">
        <Button ref={newButtonRef} variant="primary" size="md" className="w-full" onClick={onNew}>
          새 대화
        </Button>
      </div>
      <nav
        aria-label="대화 목록"
        aria-busy={status === 'loading' ? true : undefined}
        {...densityAttrs('sm')}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {status === 'loading' ? <ListSkeleton /> : null}
        {status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-2">
            <p className="m-0 text-[13px] text-text-secondary">{LIST_LOAD_ERROR}</p>
            <Button onClick={onRetry}>다시 시도</Button>
          </div>
        ) : null}
        {status === 'ready' && items.length === 0 ? (
          <p className="m-0 p-2 text-[13px] text-text-tertiary">
            저장된 대화가 없습니다. 예시 질문으로 시작해 보세요.
          </p>
        ) : null}
        {status === 'ready' && items.length > 0 ? (
          <ul ref={listRef} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {items.map((item) => (
              <li key={item.id} data-conversation-id={item.id}>
                {editingId === item.id ? (
                  <RenameField
                    initial={item.title ?? ''}
                    onCancel={() => {
                      setEditingId(null);
                      setFocusTarget({ kind: 'row', id: item.id });
                    }}
                    onSave={async (title) => {
                      const result = await onRename(item.id, title);
                      if (result.ok) {
                        setEditingId(null);
                        setFocusTarget({ kind: 'row', id: item.id });
                      }
                      return result;
                    }}
                  />
                ) : (
                  <ConversationRow
                    item={item}
                    href={hrefFor(item.id)}
                    selected={item.id === selectedId}
                    onSelect={onSelect}
                    onRename={() => setEditingId(item.id)}
                    onDelete={() => {
                      setDeleteError(null);
                      setConfirming(item);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
      <Modal
        open={confirming !== null}
        onClose={() => {
          if (deleting) return;
          const id = confirming?.id;
          setConfirming(null);
          if (id) setFocusTarget({ kind: 'row', id });
        }}
        title="대화 삭제"
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[14px] break-all">
            「{confirming ? displayTitle(confirming) : ''}」 대화를 삭제할까요?
          </p>
          <p role="note" className="m-0 text-[13px] font-semibold text-text-danger">
            {DELETE_WARNING}
          </p>
          {deleteError ? (
            <p role="alert" className="m-0 text-[13px] text-text-danger">
              {deleteError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                const id = confirming?.id;
                setConfirming(null);
                if (id) setFocusTarget({ kind: 'row', id });
              }}
              disabled={deleting}
            >
              취소
            </Button>
            <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
              삭제
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div data-testid="conversation-list-skeleton" className="flex flex-col gap-1.5 p-1">
      <p role="status" className="sr-only">
        대화 목록을 불러오는 중…
      </p>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} aria-hidden="true" className="flex flex-col gap-1.5 rounded-lg px-2 py-2">
          <div className="h-3.5 w-4/5 rounded-lg bg-gray-100" />
          <div className="h-3 w-1/3 rounded-lg bg-gray-75" />
        </div>
      ))}
    </div>
  );
}

function ConversationRow({
  item,
  href,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  item: ConversationSummary;
  href: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const title = displayTitle(item);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // 새 탭 열기(수정키·가운데 버튼)는 브라우저 기본 동작에 맡긴다
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    onSelect(item.id);
  };
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-lg',
        selected ? 'bg-primary-50' : 'hover:bg-gray-100',
      )}
    >
      <a
        href={href}
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg py-2 pr-1 pl-3 no-underline hover:no-underline',
          FOCUS_RING_CLASSES,
        )}
      >
        <span
          className={cn(
            'truncate text-[14px]',
            selected ? 'font-semibold text-primary-700' : 'font-medium text-text-primary',
          )}
        >
          {title}
        </span>
        <time
          dateTime={item.updatedAt}
          title={formatDateTime(item.updatedAt)}
          className="text-[12px] text-text-tertiary"
        >
          {formatRelativeTime(item.updatedAt)}
        </time>
      </a>
      <RowMenu label={title} onRename={onRename} onDelete={onDelete} />
    </div>
  );
}

/** ⋯ 메뉴 (메뉴 버튼 패턴): Enter·Space·클릭으로 열면 첫 항목, ↑↓·Home·End 이동, Esc 닫고 버튼으로, Tab·바깥 클릭 닫힘 */
function RowMenu({
  label,
  onRename,
  onDelete,
}: {
  label: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onClick = (event: globalThis.MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => items[(next + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') return close(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'mr-1 flex size-8 items-center justify-center rounded-lg border-0 bg-transparent text-[16px] leading-none text-text-tertiary hover:bg-gray-150 hover:text-ink-900 aria-expanded:bg-gray-150 aria-expanded:text-ink-900',
          FOCUS_RING_CLASSES,
        )}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${label} 메뉴`}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-40 mt-1 flex w-36 flex-col rounded-xl border border-neutral-100 bg-surface-card p-1 shadow-(--shadow-elevated)"
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => choose(onRename)}
            className={cn(
              'rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] text-text-primary hover:bg-gray-100',
              FOCUS_RING_CLASSES,
            )}
          >
            이름 바꾸기
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => choose(onDelete)}
            className={cn(
              'rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] text-text-danger hover:bg-error-50',
              FOCUS_RING_CLASSES,
            )}
          >
            삭제
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 제자리 이름 입력: Enter 저장(앞뒤 공백 제거 1~100자), Esc 취소, 포커스가 나가면 취소 */
function RenameField({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (title: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const save = async () => {
    const title = value.trim();
    if (!title) {
      setError(CHAT_TITLE_EMPTY_MESSAGE);
      return;
    }
    busy.current = true;
    const result = await onSave(title);
    busy.current = false;
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-1 px-1 py-1">
      <Input
        ref={inputRef}
        aria-label="대화 이름"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={value}
        maxLength={CHAT_TITLE_MAX}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!busy.current) onCancel();
        }}
      />
      {error ? (
        <p id={errorId} role="alert" className="m-0 px-1 text-[12px] text-text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
