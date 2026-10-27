/**
 * 품목 관리(조달이 통합 UI-7) 공용 상수·타입 — 순수 모듈(procurement 스키마를 import 하지 않음). 화면과 server/procurement 가 함께 쓴다.
 */

/**
 * iSIGN 세부분류 선택지 (조달이 원본 화면과 같은 8개). 이름이 세부 그룹을 정한다 — 트리거 items_before_write:
 * SSO → SSO, PKI → WA, OTP·생체인증·PIN·간편인증·인증서중계 → PASS, OS 로그온 → OS 로그온.
 */
export const ISIGN_DETAIL_CATEGORIES = [
  'SSO',
  'PKI',
  'OTP',
  '생체인증',
  'PIN',
  '간편인증',
  '인증서중계',
  'OS 로그온',
] as const;

export function isIsignDetailCategory(value: string): boolean {
  return (ISIGN_DETAIL_CATEGORIES as readonly string[]).includes(value);
}

/** 품목 관리 감사 행위 (D-8 — item_changes.action 과 같은 이름) */
export const ITEM_CHANGE_ACTIONS = ['add', 'edit', 'exclude', 'include', 'review'] as const;
export type ItemChangeAction = (typeof ITEM_CHANGE_ACTIONS)[number];

export const AUDIT_PROCUREMENT_ITEM = {
  add: 'procurement.item.add',
  edit: 'procurement.item.edit',
  exclude: 'procurement.item.exclude',
  include: 'procurement.item.include',
  review: 'procurement.item.review',
} as const satisfies Record<ItemChangeAction, string>;

/** 동시 편집 충돌 — 저장 시 현재 값이 화면이 읽은 값과 다르면(다른 관리자가 먼저 처리) 이 문구로 거부한다 */
export const ITEM_ALREADY_PROCESSED = '이미 처리됨';

/** 화면이 읽은 품목 한 줄의 식별자 + 버전(updated_at, 마이크로초) — 저장 시 재검증 기준 */
export type ItemTarget = { id: number; version: string };

/** 한 번에 처리할 수 있는 품목 수 (일괄 추가·일괄 변경·선택 삭제) */
export const ITEM_BATCH_LIMIT = 1000;

/** 일일 신규 품목 카드에 한 번에 보여 주는 최대 행 수 (넘으면 "외 N건" 안내 — 보통 하루 수 건) */
export const ITEM_REVIEW_LIMIT = 300;

/** 등록 품목 관리 표 페이지 크기 */
export const ITEM_ADMIN_PAGE_SIZE = 50;

/** 휴지통 페이지 크기 */
export const ITEM_TRASH_PAGE_SIZE = 50;
