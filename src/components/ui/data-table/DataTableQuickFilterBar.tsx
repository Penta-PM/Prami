'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DisclosureIcon, Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { registerViewFlush } from '@/lib/page-state/view-navigation';
import { OP_ORDER, withoutColumn, type FilterCondition } from '@/lib/table/filter';

import { Button } from '../button';
import { chipClass } from '../chip';
import { densityAttrs } from '../density';
import { Popover } from '../popover';
import { applyFilterFields, type DataTableFilterField } from './filter-fields';
import {
  filtersBase,
  filtersKey,
  isRequestedKey,
  reconcileFilters,
  requestFilters,
  type PendingFilters,
} from './pending-filters';
import { QuickFilterEditor } from './QuickFilterEditor';
import { splitQuickFields, summarizeField } from './quick-filters';

/** 서버 표 enum 즉시 적용의 디바운스(ms) — 마지막 체크 후 이 시간 동안 더 바뀌지 않으면 이동 요청 1회 (§2.3) */
export const SERVER_ENUM_DEBOUNCE_MS = 400;

/** money 슬라이더 확정의 디바운스(ms) — 손을 뗀 뒤(pointerup·keyup·blur) 이 시간 동안 더 움직이지 않으면 적용 (§7.5). 클라이언트·서버 표 공통 */
export const MONEY_RANGE_DEBOUNCE_MS = 400;

export type DataTableQuickFilterBarProps<T> = {
  /** 필터할 수 있는 필드(열 정의 순서). quick: true 인 필드가 고정 버튼(filterFieldsOf·withQuickFields) */
  fields: readonly DataTableFilterField<T>[];
  /** 현재(URL 에 반영된) 조건 */
  filters: readonly FilterCondition[];
  /** 조건 변경 — 다음 전체 조건(필드·연산자 순). enum 체크·적용·× 에서 부른다(키 입력마다 부르지 않는다) */
  onFiltersChange: (next: readonly FilterCondition[]) => void;
  /** '필터 초기화' — 열 필터 + 그 화면의 기존(페이지) 필터 + 정렬 해제. '열 초기화'(너비·순서)와 별개 */
  onReset: () => void;
  /** 정렬이 기본값이 아닌지 — '필터 초기화' 노출 조건에 들어간다 */
  sorted?: boolean;
  /** '필터 초기화' 를 보일지. 기본: 열 필터 또는 정렬이 기본값이 아닐 때(Q1 B). 서버 표는 페이지 필터가 있을 때도 true */
  canReset?: boolean;
  /**
   * client: 조건 변경을 바로 onFiltersChange(클라이언트 표·모달). server: enum 체크는 마지막 토글 후
   * SERVER_ENUM_DEBOUNCE_MS 디바운스(여러 개 체크 = 요청 1회) — 서버 표. 기본 client
   */
  mode?: 'client' | 'server';
  /** 클라이언트 표의 전체 행 — 바 오른쪽에 "N건" / 필터 시 "전체 N건 중 M건" */
  rows?: readonly T[];
  /** 서버 표의 결과 총 건수 — 바 오른쪽에 "총 N건" / 필터 시 "· 조건 K개" */
  total?: number;
  /** 서버 표 "조건 K개" 의 K. 기본: 조건이 걸린 열 필터 수(필드 버튼 수) */
  conditionCount?: number;
  /** 서버 표 이동 대기 중(useTransition 의 isPending) — 바에 aria-busy·진행 표시 */
  pending?: boolean;
  /**
   * 서버 표: 디바운스 중인 조건 먼저 반영 (§6 #7). path = 표 화면 경로, apply = href 에 조건을 합친 href.
   * 바가 마운트돼 있는 동안 그 경로로 가는 다른 이동(정렬·페이지·탭·페이지 필터 — navigateView·ViewStateLink)이
   * 디바운스 중인 조건을 버리지 않고 합쳐서 나간다. 버리는 것은 바가 사라질 때와 외부 URL 변경뿐
   */
  flush?: { path: string; apply: (href: string, next: readonly FilterCondition[]) => string };
  /** 같은 카드 안, 바 위에 놓을 기존 페이지 필터(가격 분류·날짜 기준·검색, 원가 제품군 탭) */
  leading?: ReactNode;
  /** 건수 앞의 안내 문구 (예: "최근 100건 안에서 필터합니다") */
  note?: ReactNode;
  /** 바(그룹) 접근성 이름. 기본 "필터" */
  label?: string;
  className?: string;
};

/** 바 줄 — 줄바꿈(320px 에서 가로 스크롤 없음, 모든 버튼 접근 — §2.7) */
const BAR_CLASS = 'flex min-w-0 flex-wrap items-center gap-1.5';

/** 바 안의 포커스 대상 — 필드 id, "＋ N개 더", 첫 버튼 */
const MORE = '__more';
const FIRST = '__first';

type Opened = { id: string | null; via: 'field' | 'more' } | null;

/** 대기 중 요청 추적 — key: 마지막으로 본 URL 조건 키, pending: 보낸 요청(R1), staged: 디바운스 중이라 아직 안 보낸 조건 */
type Track = {
  key: string;
  pending: PendingFilters | null;
  staged: readonly FilterCondition[] | null;
};

/**
 * 표 위 빠른 필터 바 (표 열 필터 빠른 필터 바 §2). 클라이언트·서버 표 공용 — 조건은 호출자가 소유한다.
 *
 * - 필드 버튼 = 칩: 고정 필드(quick)는 항상 `[상태 ⌄]`, 조건이 걸리면 `[상태: 비활성,중지 ⌄]`(⌄ = 펼치기 아이콘) + 형제 `[×]`.
 *   누르면 그 필드 편집 팝오버가 바로 열린다(열 선택 단계 없음). 고정 아닌 필드는 "＋ N개 더"(없으면 숨김) → 같은 편집기,
 *   조건이 걸리면 바에 활성 버튼으로 나타난다. 별도 '적용된 필터' 칩 줄은 없다.
 * - 즉시 적용·디바운스·R1: 다음 조건은 '보낸(대기 중) 조건'(pending-filters) → 없으면 URL 조건에서 계산한다.
 *   빠르게 연달아 바꿔도 앞 변경이 지워지지 않는다. 버튼 요약도 대기 중 조건을 먼저 보인다(낙관적 표시).
 * - 서버 표의 디바운스 중인 조건은 같은 표의 다른 이동(정렬·페이지·탭·페이지 필터·다른 필드 적용·초기화) 직전에 반영된다(flush, §6 #7).
 *   버리는 것은 바가 사라질 때(화면 이탈)와 외부 URL 변경(뒤로 가기·사이드바·조회 상태 복원)뿐.
 * - 팝오버는 마우스 이탈로 닫지 않는다. Esc·바깥 클릭 → 닫힘, 포커스는 그 필드 버튼(Popover 가 anchor 로 돌려준다).
 * - 포커스: × 뒤 같은 필드 버튼(사라지면 "＋ N개 더"), 초기화 뒤 첫 필드 버튼.
 * - 건수는 바 오른쪽 끝(좁은 화면은 다음 줄). 대기 중이면 aria-busy + 진행 표시. 결과 안내는 DataTable 라이브 영역(디바운스 1회).
 * - 바는 줄바꿈한다(320px 에서 가로 스크롤 없음). 컴포넌트 정체성을 유지해야 열린 팝오버가 닫히지 않는다 — key 를 바꾸지 말 것.
 */
export function DataTableQuickFilterBar<T>({
  fields,
  filters,
  onFiltersChange,
  onReset,
  sorted = false,
  canReset,
  mode = 'client',
  rows,
  total,
  conditionCount,
  pending = false,
  flush,
  leading,
  note,
  label = '필터',
  className,
}: DataTableQuickFilterBarProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const focusRequestRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  // 디바운스 중인 조건(track.staged 와 같은 값) — 다른 이동 직전 flush 가 동기로 읽는다
  const stagedRef = useRef<readonly FilterCondition[] | null>(null);
  const onChangeRef = useRef(onFiltersChange);
  useEffect(() => {
    onChangeRef.current = onFiltersChange;
  }, [onFiltersChange]);

  const [opened, setOpened] = useState<Opened>(null);

  // ── 대기 중 조건 (R1) ── URL 조건 키가 바뀌면 렌더 중에 맞춘다(effect 연쇄 렌더 없이)
  const currentKey = useMemo(() => filtersKey(filters), [filters]);
  const [track, setTrack] = useState<Track>(() => ({
    key: currentKey,
    pending: null,
    staged: null,
  }));
  let live = track;
  if (track.key !== currentKey) {
    // 요청 목록에 없는 값 = 외부 변경(초기화·뒤로 가기·페이지 필터) — 외부가 이긴다: 디바운스 중인 조건도 버린다
    const known = isRequestedKey(track.pending, currentKey);
    live = {
      key: currentKey,
      pending: reconcileFilters(track.pending, currentKey),
      staged: known ? track.staged : null,
    };
    setTrack(live);
  }
  const effective = live.staged ?? filtersBase(live.pending, filters);

  // 디바운스 중인 조건이 버려지면 타이머도 취소, 언마운트 시 취소(다른 화면으로 간 뒤 이동하지 않게)
  useEffect(() => {
    if (live.staged === null && timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (live.staged === null) stagedRef.current = null;
  }, [live.staged]);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const byId = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const { bar, more } = useMemo(() => splitQuickFields(fields, effective), [fields, effective]);

  // 버튼·URL 순서를 필드(열 정의) 순 → 연산자 순으로 맞춘다 — URL 파싱 결과(parseFilterParams)와 같은 순서
  const order = (conds: readonly FilterCondition[]) => {
    const index = (col: string) => fields.findIndex((field) => field.id === col);
    return [...conds].sort(
      (a, b) => index(a.col) - index(b.col) || OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op),
    );
  };

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    stagedRef.current = null;
  };

  // ── 디바운스 중인 조건 flush (§6 #7) ── 같은 경로로 가는 다른 이동 직전에 불린다(view-navigation)
  const flushPath = flush?.path;
  const flushApplyRef = useRef(flush?.apply);
  useEffect(() => {
    flushApplyRef.current = flush?.apply;
  });
  useEffect(() => {
    if (!flushPath) return;
    return registerViewFlush(flushPath, (href) => {
      const staged = stagedRef.current;
      const apply = flushApplyRef.current;
      if (staged === null || timerRef.current === null || !apply) return href;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      stagedRef.current = null;
      // 보낸 요청으로 옮긴다 — 합친 이동이 반영되면 URL 조건 = staged 라 대기 상태가 정리된다
      setTrack((prev) => ({
        ...prev,
        staged: null,
        pending: requestFilters(prev.pending, staged),
      }));
      return apply(href, staged);
    });
  }, [flushPath]);

  /** 지금 보낸다 — 디바운스 중인 조건은 next 에 이미 들어 있으므로 취소 */
  const send = (next: readonly FilterCondition[]) => {
    const ordered = order(next);
    clearTimer();
    setTrack((prev) => ({ ...prev, staged: null, pending: requestFilters(prev.pending, ordered) }));
    onChangeRef.current(ordered);
  };

  /** 디바운스 후 보낸다 — 대기 조건(R1)·flush 경로는 같다. 기다리는 동안 버튼 요약은 staged 를 먼저 보인다 */
  const stage = (next: readonly FilterCondition[], delay: number) => {
    const ordered = order(next);
    setTrack((prev) => ({ ...prev, staged: ordered }));
    clearTimer();
    stagedRef.current = ordered;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      stagedRef.current = null;
      setTrack((prev) => ({
        ...prev,
        staged: null,
        pending: requestFilters(prev.pending, ordered),
      }));
      onChangeRef.current(ordered);
    }, delay);
  };

  /** enum 체크 — 클라이언트 표는 즉시, 서버 표는 마지막 토글 후 디바운스 */
  const toggle = (next: readonly FilterCondition[]) =>
    mode === 'client' ? send(next) : stage(next, SERVER_ENUM_DEBOUNCE_MS);

  const find = (target: string): HTMLElement | null => {
    const root = rootRef.current;
    if (!root) return null;
    if (target === MORE) return root.querySelector<HTMLElement>('[data-quick-filter-more]');
    if (target === FIRST) return root.querySelector<HTMLElement>('[data-table-filter-trigger]');
    return root.querySelector<HTMLElement>(`[data-quick-field="${target}"]`);
  };

  // 포커스 요청은 다음 렌더 뒤에 처리한다 — 버튼이 생기거나 사라진 뒤의 DOM 기준
  useEffect(() => {
    const want = focusRequestRef.current;
    if (!want) return;
    focusRequestRef.current = null;
    (find(want) ?? find(MORE) ?? find(FIRST))?.focus();
  });

  // 열린 팝오버의 기준(포커스 복귀 대상)을 그 필드 버튼으로 — "＋ 더" 에서 연 필드에 조건이 걸려 버튼이 생겼거나,
  // 고정 아닌 필드의 조건을 풀어 버튼이 사라졌으면 "＋ N개 더"
  useEffect(() => {
    if (!opened) return;
    const target = (opened.id ? find(opened.id) : null) ?? find(MORE);
    if (target) anchorRef.current = target;
  });

  const close = () => setOpened(null);

  const openFrom = (event: { currentTarget: HTMLElement }, next: Opened) => {
    anchorRef.current = event.currentTarget;
    setOpened(next);
  };

  const showReset = canReset ?? (filters.length > 0 || sorted);
  const editingField = opened?.id ? byId.get(opened.id) : undefined;
  const filtered = filters.length > 0;
  const activeCount = conditionCount ?? new Set(filters.map((cond) => cond.col)).size;

  const visibleCount = useMemo(
    () => (rows && filters.length > 0 ? applyFilterFields(rows, filters, fields).length : null),
    [rows, filters, fields],
  );

  let count: string | null = null;
  if (rows)
    count =
      visibleCount !== null ? `전체 ${rows.length}건 중 ${visibleCount}건` : `${rows.length}건`;
  else if (total !== undefined)
    count = filtered && activeCount > 0 ? `총 ${total}건 · 조건 ${activeCount}개` : `총 ${total}건`;

  const barItems = (
    <>
      {bar.map((field) => {
        const summary = summarizeField(field, effective);
        const expanded = opened?.id === field.id;
        return (
          <span key={field.id} className="inline-flex max-w-full min-w-0 items-center gap-0.5">
            <button
              type="button"
              data-quick-field={field.id}
              data-table-filter-trigger=""
              aria-haspopup="dialog"
              aria-expanded={expanded}
              aria-label={
                summary ? `${field.label} 필터, ${summary.full} 적용 중` : `${field.label} 필터`
              }
              onClick={(event) => {
                if (expanded) close();
                else openFrom(event, { id: field.id, via: 'field' });
              }}
              className={cn(chipClass(summary !== null), 'max-w-[min(100%,260px)] min-w-0 gap-1')}
            >
              <span className="min-w-0 truncate">
                {field.label}
                {summary ? `: ${summary.text}` : null}
              </span>
              <DisclosureIcon open={false} />
            </button>
            {summary ? (
              <button
                type="button"
                aria-label={`${field.label} 필터 해제`}
                onClick={() => {
                  send(withoutColumn(effective, field.id));
                  if (opened?.id === field.id) close();
                  focusRequestRef.current = field.id;
                }}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-tertiary hover:bg-gray-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <Icon name="close" />
              </button>
            ) : null}
          </span>
        );
      })}

      {more.length > 0 ? (
        <Button
          variant="ghost"
          data-quick-filter-more=""
          data-table-filter-trigger=""
          aria-haspopup="dialog"
          aria-expanded={opened?.via === 'more'}
          onClick={(event) => {
            if (opened?.via === 'more') close();
            else openFrom(event, { id: null, via: 'more' });
          }}
        >
          ＋ {more.length}개 더
        </Button>
      ) : null}

      <Popover
        // 필드가 바뀌면 새 팝오버로 다시 열어 그 필드의 첫 입력으로 포커스한다
        key={opened?.id ?? MORE}
        open={opened !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        anchorRef={anchorRef}
        label={editingField ? `${editingField.label} 필터` : '필터 더 보기'}
      >
        {editingField ? (
          <QuickFilterEditor
            field={editingField}
            fields={fields}
            filters={effective}
            onToggle={toggle}
            // money 슬라이더: 손을 뗀 뒤 디바운스, 팝오버는 열어 둔다 (§7.5 — §6 의 "범위 적용 후 닫힘"을 money 에 한해 개정)
            onStage={(next) => stage(next, MONEY_RANGE_DEBOUNCE_MS)}
            onApply={(next) => {
              send(next);
              close();
              focusRequestRef.current = editingField.id;
            }}
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            <p className="m-0 mb-2 text-[12px] font-semibold text-text-secondary">필터할 열</p>
            {more.map((field) => (
              <button
                key={field.id}
                type="button"
                onClick={() => setOpened({ id: field.id, via: 'more' })}
                className="flex min-h-10 w-full min-w-0 items-center justify-between rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[14px] break-words text-ink-900 hover:bg-gray-75 focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                {field.label}
              </button>
            ))}
          </div>
        )}
      </Popover>

      {showReset ? (
        <Button
          variant="ghost"
          onClick={() => {
            clearTimer();
            setTrack((prev) => ({
              ...prev,
              staged: null,
              pending: requestFilters(prev.pending, []),
            }));
            onReset();
            close();
            // 버튼이 사라지므로 포커스를 첫 필드 버튼으로 옮긴다
            focusRequestRef.current = FIRST;
          }}
        >
          필터 초기화
        </Button>
      ) : null}

      {note || count || pending ? (
        <span className="ml-auto inline-flex min-w-0 flex-wrap items-center justify-end gap-2 text-[12px] text-text-tertiary max-sm:w-full">
          {note ? <span>{note}</span> : null}
          {pending ? (
            <span
              data-quick-filter-progress=""
              aria-hidden="true"
              className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
            />
          ) : null}
          {count ? (
            <span data-quick-filter-count="" className="font-semibold">
              {count}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  // 페이지 필터(leading)가 있으면 같은 카드 안에 위 = 페이지 필터, 아래 = 바. 없으면 그룹 자신이 바
  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      // 빠른 필터 바는 밀집 컨테이너 — 안의 칩·버튼·입력(페이지 필터 leading 포함)·팝오버 편집기는 sm 36·14 (Q-D1 = B)
      {...densityAttrs('sm')}
      aria-busy={pending || undefined}
      data-quick-filter-bar={leading ? undefined : ''}
      className={cn(
        leading
          ? 'flex min-w-0 flex-col gap-3 rounded-[10px] bg-surface-card p-3 shadow-(--hairline-default)'
          : BAR_CLASS,
        className,
      )}
    >
      {leading ? (
        <>
          <div className="flex min-w-0 flex-col gap-2">{leading}</div>
          <div data-quick-filter-bar="" className={BAR_CLASS}>
            {barItems}
          </div>
        </>
      ) : (
        barItems
      )}
    </div>
  );
}
