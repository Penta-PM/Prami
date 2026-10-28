'use client';

import { Button, Checkbox, Select } from '@/components/ui';
import { priceLabel } from '@/lib/pricing/format';
import { groupSubtotal } from '@/lib/pricing/quote';

import { Chip, QtyControl, StepCard } from './chips';
import type {
  CartLineInput,
  GroupChipView,
  GroupItemState,
  GroupSelection,
  QuoteItemView,
} from './types';

type GroupSolutionProps = {
  /** 현재 제품군 — 선택 상태는 제품군별(다른 제품군의 선택은 보이지 않는다) */
  family: string;
  groups: readonly GroupChipView[];
  hardware: readonly QuoteItemView[];
  /** 선택 상태 (부모가 보관 — 입력 초안 group-solution 저장·복원·새로 시작, page-state-memory §2.4) */
  selection: GroupSelection | null;
  onSelection: (next: GroupSelection) => void;
  onAdd: (line: CartLineInput) => void;
};

/**
 * 그룹 솔루션 (§4.5.7, AC-33 UI): PR-6 솔루션 그룹 칩 → 하드웨어(같은 제품군 본품) 선택 → 상세 제품 체크/수량 → 그룹 소계
 * → 그룹 라인으로 장바구니 담기. 항목 가격은 조회 시점 정상판매가(가격 미등록 항목은 0원 표시·제외 권장).
 */
export function GroupSolution({
  family,
  groups,
  hardware,
  selection,
  onSelection,
  onAdd,
}: GroupSolutionProps) {
  const current = selection?.family === family ? selection : null;
  const groupId = current?.groupId ?? null;
  const hardwareCode = current?.hardwareCode ?? '';
  const itemState = current?.items ?? {};
  const group = groups.find((entry) => entry.id === groupId) ?? null;
  const machine = hardware.find((entry) => entry.itemCode === hardwareCode) ?? null;

  if (groups.length === 0) return null;

  const select = (next: GroupChipView) =>
    onSelection({
      family,
      groupId: next.id,
      hardwareCode: hardware[0]?.itemCode ?? '',
      items: Object.fromEntries(
        next.items.map((item) => [item.itemCode, { checked: true, qty: item.defaultQty }]),
      ),
    });
  const setHardwareCode = (code: string) =>
    onSelection({ family, groupId, hardwareCode: code, items: itemState });
  const update = (code: string, patch: Partial<GroupItemState>) =>
    onSelection({
      family,
      groupId,
      hardwareCode,
      items: { ...itemState, [code]: { ...itemState[code]!, ...patch } },
    });

  const rows = group?.items ?? [];
  const subtotal = groupSubtotal(
    machine ? Number(machine.unitPrice) : 0,
    rows.map((item) => ({
      unitPrice: Number(item.unitPrice ?? 0),
      qty: itemState[item.itemCode]?.qty ?? 1,
      checked: itemState[item.itemCode]?.checked ?? false,
    })),
  );
  const currency = machine?.currency ?? rows.find((item) => item.currency)?.currency ?? 'KRW';

  const add = () => {
    if (!group) return;
    onAdd({
      kind: 'group',
      groupId: group.id,
      itemCode: machine?.itemCode,
      name: machine ? `${group.name} · ${machine.itemName}` : group.name,
      priceType: '정상판매',
      qty: 1,
      unitPrice: machine ? Number(machine.unitPrice) : 0,
      currency,
      parts: [],
      bundles: [],
      groupItems: rows
        .filter((item) => itemState[item.itemCode]?.checked)
        .map((item) => ({
          itemCode: item.itemCode,
          itemName: item.itemName,
          unitPrice: Number(item.unitPrice ?? 0),
          qty: itemState[item.itemCode]?.qty ?? 1,
        })),
      discountRate: 0,
    });
  };

  return (
    <StepCard title="그룹 솔루션 (선택 시 상세 제품 일괄 구성)" aria-label="그룹 솔루션">
      <p className="m-0 mb-3.5 text-[11px] text-text-tertiary">
        여러 상세 제품이 묶인 솔루션입니다. 하드웨어를 고르고, 필요 없는 상세 제품은 체크 해제하거나
        수량을 조절하세요.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="그룹 칩">
        {groups.map((entry) => (
          <Chip key={entry.id} active={entry.id === groupId} onClick={() => select(entry)}>
            {entry.name}
          </Chip>
        ))}
      </div>
      {group ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-text-secondary">하드웨어 장비 선택</span>
            <Select value={hardwareCode} onChange={(event) => setHardwareCode(event.target.value)}>
              <option value="">하드웨어 없음</option>
              {hardware.map((entry) => (
                <option key={entry.itemCode} value={entry.itemCode}>
                  {entry.itemName} · {priceLabel(entry.unitPrice, entry.currency)}
                </option>
              ))}
            </Select>
          </label>
          <div className="text-[12px] font-medium text-text-secondary">
            상세 제품 (제외할 항목은 체크 해제, 수량 조절 가능)
          </div>
          <div className="flex flex-col gap-1.5" role="group" aria-label="그룹 상세 제품">
            {rows.map((item) => {
              const state = itemState[item.itemCode] ?? { checked: false, qty: 1 };
              return (
                <div
                  key={item.itemCode}
                  className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-[12px] font-medium shadow-(--hairline-subtle)"
                >
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={state.checked}
                      onChange={(event) => update(item.itemCode, { checked: event.target.checked })}
                    />
                    {item.itemName}
                  </label>
                  <span className="flex items-center gap-2.5">
                    <QtyControl
                      size="sm"
                      label={`${item.itemName} 수량`}
                      value={state.qty}
                      onChange={(qty) => update(item.itemCode, { qty })}
                    />
                    <span className="w-[90px] text-right text-[11px] font-semibold text-text-tertiary">
                      {item.unitPrice
                        ? priceLabel(Number(item.unitPrice) * state.qty, item.currency ?? currency)
                        : '가격 미등록'}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-border-subtle pt-2">
            <span className="text-[14px] font-semibold">그룹 소계</span>
            <span className="text-[15px] font-bold" data-testid="group-subtotal">
              {priceLabel(subtotal, currency)}
            </span>
          </div>
          <Button variant="primary" onClick={add}>
            + 그룹 장바구니에 담기
          </Button>
        </div>
      ) : null}
    </StepCard>
  );
}
