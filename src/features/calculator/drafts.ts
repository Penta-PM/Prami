import type { GroupSolutionDraft, MarginDraft, QuoteDraft } from '@/lib/page-state/drafts';

import type { GroupSelection, MarginDraftValues, QuoteFormState } from './types';

/**
 * 계산기 화면 상태 → 입력 초안 값 (page-state-memory §2.4-1). 빈 상태(처음 화면과 같음)면 null — 서버 초안을 지운다.
 * 화면 값과 복원 형태(다른 탭 초안 다시 읽기)가 같은 함수를 거쳐 비교된다.
 */

/**
 * 견적 계산기 저장 필드 (PR 본문 목록과 같음): 제품군·단가유형·중분류·소분류·품목(품번 + 판매 단가 스냅샷)·수량·파츠·결합형·할인율·목표 금액.
 * 빈 상태 = 기본 제품군·첫 단가유형·분류/품목 없음·할인 0.
 */
export function quoteDraftOf(
  form: QuoteFormState,
  defaults: { family: string; priceType: string | null },
): QuoteDraft | null {
  const untouched =
    form.family === defaults.family &&
    form.priceType === defaults.priceType &&
    form.mid === null &&
    form.minor === null &&
    form.selected === null &&
    form.rate === 0 &&
    form.target === '';
  if (untouched || form.family === '') return null;
  return {
    family: form.family,
    priceType: form.priceType,
    mid: form.mid,
    minor: form.minor,
    itemCode: form.selected?.itemCode ?? null,
    unitPrice: form.selected ? Number(form.selected.unitPrice) : null,
    qty: form.qty,
    parts: [...form.parts].sort(),
    bundles: [...form.bundles].sort(),
    rate: form.rate,
    target: form.target,
  };
}

/** 순매출 계산기 — 원가 입력(원가 단가·기타 비용)은 받지도 않는다(§2.1-3). 빈 상태 = 처음 값 */
export const MARGIN_DRAFT_INITIAL: MarginDraftValues = {
  sellingPrice: '',
  quantity: '1',
  discountRate: '0',
};

export function marginDraftOf(values: MarginDraftValues): MarginDraft | null {
  const draft = {
    sellingPrice: values.sellingPrice,
    quantity: values.quantity,
    discountRate: values.discountRate,
  };
  const untouched = (Object.keys(draft) as (keyof MarginDraft)[]).every(
    (key) => draft[key] === MARGIN_DRAFT_INITIAL[key],
  );
  return untouched ? null : draft;
}

/** 그룹 솔루션 — 그룹을 고르지 않았으면 빈 상태 */
export function groupDraftOf(selection: GroupSelection | null): GroupSolutionDraft | null {
  if (!selection?.groupId) return null;
  return {
    family: selection.family,
    groupId: selection.groupId,
    hardwareCode: selection.hardwareCode,
    items: Object.entries(selection.items)
      .map(([itemCode, state]) => ({ itemCode, checked: state.checked, qty: state.qty }))
      .sort((a, b) => (a.itemCode < b.itemCode ? -1 : 1)),
  };
}
