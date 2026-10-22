/**
 * ERP 업로드 안내 문구 (스펙 erp-upload-guide §2-4). 모두 사용자 원문 그대로 — 띄어쓰기·화살표 표기만 정리했다.
 * 원문의 `->` 는 단계 사이 화살표(→)로 그리므로 단계 문자열에는 넣지 않는다(ErpDataGuide 가 <ol> + 장식 화살표로 렌더).
 *
 * Main 답(§6, 사용자 확인):
 * - Q-E1: 상시 박스 없이 "PRAMI ERP 데이터" 버튼 → 공통 설명 팝오버 (ErpDataGuide = InfoHint + 보이는 글자)
 * - Q-E2: 두 줄 → `ERP_GUIDE_INTRO`(1줄) + `ERP_GUIDE_STEPS`(2줄째 단계 목록)
 * - Q-E3: 항목 4 ⓘ 는 `/admin/costs/links` 제목 옆 → `ERP_HINT_ITEM_COST_LINK_ON_LINKS_PAGE`. 매칭 파일 업로드는 별도 PR(§6.2)
 */

/** 공통 설명 제목 */
export const ERP_GUIDE_TITLE = 'PRAMI ERP 데이터';

/** 공통 설명 1줄째 */
export const ERP_GUIDE_INTRO = '아래 내용에 대해 ERP에서 조회한 후';

/**
 * 공통 설명 2줄째 — 원문 "전체 리스트 드래그 -> (우클릭) -> [EXCEL로 전송하기] 클릭 (자동 다운로드) -> 파일 업로드".
 * `strong` 은 굵게 표시할 앞부분(대괄호 유지), `text` 는 그 뒤(또는 단계 전체) 글자.
 */
export const ERP_GUIDE_STEPS: readonly { strong?: string; text: string }[] = [
  { text: '전체 리스트 드래그' },
  { text: '(우클릭)' },
  { strong: '[EXCEL로 전송하기]', text: ' 클릭 (자동 다운로드)' },
  { text: '파일 업로드' },
];

export type ErpHint = { item: string; path: string };

/** 항목 1 — 판매단가 파일 칸 */
export const ERP_HINT_SALES: ErpHint = {
  item: '가격정책 관리 품목 업데이트',
  path: '기본정보 > 품목단가 > 판매단가등록',
};

/** 항목 2 — 품목상태 파일 칸 */
export const ERP_HINT_ITEMS: ErpHint = {
  item: '사용, 폐기 등 품목 상태 정보 업데이트',
  path: '기본정보 > 품목 > 품목조회',
};

/** 항목 3 — 원가 파일 칸 */
export const ERP_HINT_COSTS: ErpHint = {
  item: '원가 관리 업데이트',
  path: '기본정보 > 품목단가 > 구매단가등록(계약)',
};

/** 항목 4 — 품목-원가 매칭 (업로드 칸 없음, Q-E3) */
export const ERP_HINT_COST_LINK: ErpHint = {
  item: '품목 - 원가 매칭 업데이트',
  path: '기본정보 > 품목 > 품목조회(추가정보)',
};

/** Q-E3 — 원가 매핑 화면 제목 옆에 항목 4 InfoHint 를 둔다(그 화면에는 공통 설명 버튼 없음 — 업로드 칸이 없다) */
export const ERP_HINT_ITEM_COST_LINK_ON_LINKS_PAGE = true;
