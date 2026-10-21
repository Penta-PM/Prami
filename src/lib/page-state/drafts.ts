import { z } from 'zod';

import type { PermissionKey } from '@/lib/constants/permissions';
import { formatDateTime } from '@/lib/date-format';

import { byteLength } from './keys';

/**
 * 입력 초안 (page-state-memory §2.4) — 클라이언트(저장 훅)·서버(저장소·액션·RSC 복원) 공용 순수 모듈.
 * - draft_key 화이트리스트: 견적 계산기 선택값·장바구니·순매출 계산기(원가 제외)·그룹 솔루션. 그 밖의 키는 저장·복원하지 않는다.
 * - 초안마다 버전 + zod 스키마. 객체 스키마는 기본(strip)이라 **알 수 없는 필드는 버리고**, 형식이 어긋나거나 버전이 다르면 폐기한다.
 * - **원가 값은 스키마에 없다**(§2.1-3): 순매출 초안은 판매가·수량·할인율만 — 원가(unitCost)·기타 비용(miscCost)은 저장 직전 버려진다.
 */
export const DRAFT_KEYS = ['quote', 'cart', 'margin', 'group-solution'] as const;
export type DraftKey = (typeof DRAFT_KEYS)[number];

/** 초안 스키마 버전 — 스키마를 바꾸면 올린다(옛 초안은 읽을 때 폐기) */
export const DRAFT_VERSIONS: Readonly<Record<DraftKey, number>> = {
  quote: 1,
  cart: 1,
  margin: 1,
  'group-solution': 1,
};

/** 초안을 쓰는 화면의 권한 — 네 초안 모두 계산기(calculator.use) */
export const DRAFT_PERMISSIONS: Readonly<Record<DraftKey, PermissionKey>> = {
  quote: 'calculator.use',
  cart: 'calculator.use',
  margin: 'calculator.use',
  'group-solution': 'calculator.use',
};

/** 초안 최대 크기(UTF-8 바이트, §2.4-2) */
export const DRAFT_MAX_BYTES = 50 * 1024;

/** 변경 후 저장까지 기다리는 시간 (§2.4-2) */
export const DRAFT_SAVE_DEBOUNCE_MS = 1000;

/** 유지 기간: 마지막 수정 후 30일 (§2.4-4) */
export const DRAFT_TTL_DAYS = 30;
const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;

const code = z.string().trim().min(1).max(50);
const label = z.string().trim().max(100);
const money = z.number().finite().min(0).max(1e15);
const qty = z.number().int().min(1).max(9999);
const rate = z.number().finite().min(0).max(100);
/** 화면 입력 문자열(숫자 입력칸 원문) — React 텍스트로만 렌더한다 */
const inputText = z.string().max(30);

/**
 * 견적 계산기 선택값 (§2.4-1 quote — PR 본문에 같은 목록을 적는다).
 * 제품군 · 단가유형 · 중분류 · 소분류 · 품목(품번 + 선택 시점 판매 단가 — 복원 시 가격 변동 감지용) · 수량 · 파츠 · 결합형 · 할인율 · 목표 금액.
 */
export const quoteDraftSchema = z.object({
  family: z.string().trim().min(1).max(50),
  priceType: label.min(1).nullable(),
  mid: label.min(1).nullable(),
  minor: label.min(1).nullable(),
  itemCode: code.nullable(),
  unitPrice: money.nullable(),
  qty,
  parts: z.array(code).max(100),
  bundles: z.array(code).max(100),
  rate,
  target: inputText,
});

const pricedOption = z.object({
  itemCode: code,
  itemName: z.string().trim().min(1).max(300),
  unitPrice: money,
});

/** 장바구니 라인 = 견적 저장 입력과 같은 필드(id·표시용 금액은 복원 때 다시 계산) */
export const cartLineDraftSchema = z.object({
  kind: z.enum(['item', 'group']),
  itemCode: code.optional(),
  groupId: z.uuid().optional(),
  name: z.string().trim().min(1).max(300),
  priceType: label.optional(),
  qty,
  unitPrice: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  parts: z.array(pricedOption).max(100),
  bundles: z.array(pricedOption).max(100),
  groupItems: z.array(pricedOption.extend({ qty })).max(200),
  discountRate: rate,
});

export const cartDraftSchema = z.object({ lines: z.array(cartLineDraftSchema).min(1).max(200) });

/** 순매출 계산기 — **원가 입력(원가 단가·기타 비용) 제외** (§2.1-3·§2.4-1) */
export const marginDraftSchema = z.object({
  sellingPrice: inputText,
  quantity: inputText,
  discountRate: inputText,
});

/** 그룹 솔루션 선택 — 제품군 · 그룹 · 하드웨어 · 상세 제품 체크/수량 */
export const groupSolutionDraftSchema = z.object({
  family: z.string().trim().min(1).max(50),
  groupId: z.uuid(),
  hardwareCode: z.string().trim().max(50),
  items: z.array(z.object({ itemCode: code, checked: z.boolean(), qty })).max(200),
});

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;
export type CartLineDraft = z.infer<typeof cartLineDraftSchema>;
export type CartDraft = z.infer<typeof cartDraftSchema>;
export type MarginDraft = z.infer<typeof marginDraftSchema>;
export type GroupSolutionDraft = z.infer<typeof groupSolutionDraftSchema>;

export type DraftDataMap = {
  quote: QuoteDraft;
  cart: CartDraft;
  margin: MarginDraft;
  'group-solution': GroupSolutionDraft;
};
export type DraftOf<K extends DraftKey> = DraftDataMap[K];

const SCHEMAS: { [K in DraftKey]: z.ZodType<DraftDataMap[K]> } = {
  quote: quoteDraftSchema,
  cart: cartDraftSchema,
  margin: marginDraftSchema,
  'group-solution': groupSolutionDraftSchema,
};

export function isDraftKey(value: unknown): value is DraftKey {
  return typeof value === 'string' && (DRAFT_KEYS as readonly string[]).includes(value);
}

/**
 * 초안 검증 — 버전이 다르거나 스키마에 맞지 않으면 null(폐기). 맞으면 화이트리스트 필드만 남긴 값.
 * 원가 필드처럼 스키마에 없는 필드는 여기서 사라진다.
 */
export function parseDraft<K extends DraftKey>(
  key: K,
  version: unknown,
  data: unknown,
): DraftOf<K> | null {
  if (!isDraftKey(key) || version !== DRAFT_VERSIONS[key]) return null;
  const parsed = SCHEMAS[key].safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** 객체 키를 정렬한 JSON — 클라이언트 값과 서버 값(스키마 순서)을 같은 문자열로 비교한다 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : entry,
  );
}

/** 초안 크기(UTF-8 바이트) */
export function draftByteLength(data: unknown): number {
  return byteLength(JSON.stringify(data) ?? '');
}

/** 마지막 수정 후 30일이 지났는가 */
export function isDraftExpired(updatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() > DRAFT_TTL_MS;
}

/** 복원 배너 시각 `MM-DD HH:mm` (한국 시간 — 서버·클라이언트 같은 문자열이라 하이드레이션 안전) */
export function formatRestoredAt(value: string | Date): string {
  return formatDateTime(value).slice(5);
}

/** 최신가 갱신 안내 (§2.5) — 0건이면 문구 없음 */
export function repriceNotices(changed: number, removed: number): string[] {
  const notices: string[] = [];
  if (changed > 0) notices.push(`가격이 바뀐 품목 ${changed}건을 최신가로 갱신했습니다`);
  if (removed > 0) notices.push(`${removed}건은 더 이상 판매하지 않아 제외했습니다`);
  return notices;
}
