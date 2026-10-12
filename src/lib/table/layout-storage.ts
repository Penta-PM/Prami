// 클라이언트(표 컴포넌트)에서 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';

/**
 * 표 열 너비·순서 저장 (#32 스펙 §5). localStorage 에만 둔다 — DB 저장은 하지 않는다.
 * 키에 버전(v1)과 userId 를 넣어 형식 변경·다른 계정과 섞이지 않게 한다.
 * 손상된 값은 기본값으로 돌아가고, localStorage 접근 실패(사파리 프라이빗 모드·쿼터 초과 등)는 삼킨다.
 */

export const MIN_COL_WIDTH = 60;
export const MAX_COL_WIDTH = 600;

export type TableLayout = { order: string[]; widths: Record<string, number> };
export type LayoutColumn = {
  id: string;
  pinned?: 'start' | 'end';
  minWidth?: number;
  maxWidth?: number;
  reorderable?: boolean;
};

/** 같은 탭 구독자 알림용 이벤트 — 'storage' 이벤트는 다른 탭에서만 발생한다 */
const LAYOUT_EVENT = 'prami:table-layout';
type LayoutEventDetail = { key: string };

/** 너비 값은 형태만 받고 유한수 검사·clamp 는 normalizeLayout 에서 한다 (한 칸이 틀려도 나머지는 살린다) */
const storedLayoutSchema = z.object({
  order: z.array(z.string()),
  widths: z.record(z.string(), z.unknown()).optional(),
});

/** `prami:table:${tableId}:v1:${userId}` */
export function layoutStorageKey(tableId: string, userId: string): string {
  return `prami:table:${tableId}:v1:${userId}`;
}

/** 기본 순서 = columns 배열 순서 */
export function defaultLayout(columns: readonly LayoutColumn[]): TableLayout {
  return { order: columns.map((column) => column.id), widths: {} };
}

/** 이동할 수 없는 열 — 고정 열, reorderable:false 열 */
function isMovable(column: LayoutColumn): boolean {
  return column.pinned === undefined && column.reorderable !== false;
}

/**
 * 가운데(고정 아닌) 구간의 순서를 만든다.
 * 1) 저장된 순서에서 이동 가능한 열만 남기고 2) 저장에 없는 새 열을 기본 순서상 바로 앞 열 뒤(없으면 맨 앞)에 끼운 뒤
 * 3) reorderable:false 열을 기본 위치(가운데 구간 안 인덱스)에 다시 넣는다.
 */
function normalizeMiddle(saved: readonly string[], middle: readonly LayoutColumn[]): string[] {
  const movable = middle.filter(isMovable).map((column) => column.id);
  const movableSet = new Set(movable);
  const result = saved.filter((id) => movableSet.has(id));
  const placed = new Set(result);

  movable.forEach((id, index) => {
    if (placed.has(id)) return;
    const prev = index > 0 ? movable[index - 1] : undefined;
    const at = prev === undefined ? 0 : result.indexOf(prev) + 1;
    result.splice(at, 0, id);
    placed.add(id);
  });

  middle.forEach((column, index) => {
    if (!isMovable(column)) result.splice(Math.min(index, result.length), 0, column.id);
  });
  return result;
}

function clampWidth(value: number, column: LayoutColumn): number {
  const min = column.minWidth ?? MIN_COL_WIDTH;
  const max = column.maxWidth ?? MAX_COL_WIDTH;
  return Math.round(Math.min(Math.max(value, min), max));
}

/** raw(JSON.parse 결과 등 unknown)를 zod 로 검증해 정규화. 형태가 틀리면 null.
 *  - order: 모르는 colId·중복 제거. columns 에 있는데 order 에 없는 새 열은 기본 위치(기본 순서에서 바로 앞 열의 뒤, 없으면 맨 앞)에 끼운다.
 *  - pinned 'start' 열은 항상 맨 앞, 'end' 열은 항상 맨 뒤(기본 순서 상대 위치 유지). reorderable:false 인 열도 기본 위치에 고정.
 *  - widths: 모르는 colId 제거, 유한수가 아니면 제거, [minWidth??60, maxWidth??600] 로 clamp, 정수로 반올림. */
export function normalizeLayout(
  raw: unknown,
  columns: readonly LayoutColumn[],
): TableLayout | null {
  const parsed = storedLayoutSchema.safeParse(raw);
  if (!parsed.success) return null;

  const byId = new Map(columns.map((column) => [column.id, column]));
  const saved = [...new Set(parsed.data.order)].filter((id) => byId.has(id));

  const start = columns.filter((column) => column.pinned === 'start').map((column) => column.id);
  const end = columns.filter((column) => column.pinned === 'end').map((column) => column.id);
  const middle = columns.filter((column) => column.pinned === undefined);
  const order = [...start, ...normalizeMiddle(saved, middle), ...end];

  const widths: Record<string, number> = {};
  for (const [id, value] of Object.entries(parsed.data.widths ?? {})) {
    const column = byId.get(id);
    if (!column || typeof value !== 'number' || !Number.isFinite(value)) continue;
    widths[id] = clampWidth(value, column);
  }
  return { order, widths };
}

/** order 가 기본 순서와 같고 widths 가 비었으면 true ('열 초기화' 비활성 판정) */
export function isDefaultLayout(layout: TableLayout, columns: readonly LayoutColumn[]): boolean {
  if (Object.keys(layout.widths).length > 0) return false;
  if (layout.order.length !== columns.length) return false;
  return columns.every((column, index) => layout.order[index] === column.id);
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // 저장소가 막힌 환경에서는 접근자 자체가 던진다
    return null;
  }
}

/**
 * 메모리 폴백 (#32 스펙 §9 Q3 A) — localStorage 쓰기가 실패하면(프라이빗 모드·쿼터·차단) 그 탭 안에서만 값을 들고 있는다.
 * null 은 "지움"을 뜻한다. 새로고침하면 사라지고(모듈 상태), 오류는 표시하지 않는다. 쓰기가 다시 성공하면 비운다.
 */
const memoryFallback = new Map<string, string | null>();

/** localStorage 의 원문 문자열 (없거나 접근 불가면 null). 쓰기 실패로 메모리 폴백이 있으면 그 값. 예외를 던지지 않는다 */
export function readLayoutRaw(key: string): string | null {
  if (memoryFallback.has(key)) return memoryFallback.get(key) ?? null;
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 문자열 → normalizeLayout. JSON 파싱 실패·검증 실패면 null */
export function parseLayout(
  raw: string | null,
  columns: readonly LayoutColumn[],
): TableLayout | null {
  if (raw === null) return null;
  try {
    return normalizeLayout(JSON.parse(raw), columns);
  } catch {
    return null;
  }
}

function notify(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<LayoutEventDetail>(LAYOUT_EVENT, { detail: { key } }));
  } catch {
    // 알림 실패는 저장 결과에 영향이 없다
  }
}

/** 저장 후 같은 탭 구독자에게도 알린다(CustomEvent 'prami:table-layout' detail {key}). isDefaultLayout 이면 removeItem.
 *  쓰기가 실패하면 메모리 폴백에 둔다 — 화면은 이번 탭 안에서 바뀌고 저장만 건너뛴다 */
export function writeLayout(
  key: string,
  layout: TableLayout,
  columns: readonly LayoutColumn[],
): void {
  const value = isDefaultLayout(layout, columns) ? null : JSON.stringify(layout);
  persist(key, value);
  notify(key);
}

export function clearLayout(key: string): void {
  persist(key, null);
  notify(key);
}

function persist(key: string, value: string | null): void {
  try {
    const storage = getStorage();
    if (!storage) throw new Error('localStorage unavailable');
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    memoryFallback.delete(key);
  } catch {
    // 쿼터 초과·프라이빗 모드 — 이번 탭 화면만 바뀌고 저장은 건너뛴다
    memoryFallback.set(key, value);
  }
}

/** useSyncExternalStore 용 구독: window 'storage'(e.key===key) + 'prami:table-layout'(detail.key===key). unsubscribe 반환. SSR(window 없음)이면 no-op */
export function subscribeLayout(key: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    // 다른 탭의 localStorage.clear() 는 key 가 null 로 온다 — 이 표도 다시 읽는다
    if (event.key === key || event.key === null) onChange();
  };
  const onLayout = (event: Event) => {
    const detail = (event as CustomEvent<LayoutEventDetail | undefined>).detail;
    if (detail?.key === key) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(LAYOUT_EVENT, onLayout);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LAYOUT_EVENT, onLayout);
  };
}
