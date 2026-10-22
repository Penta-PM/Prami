'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition, type FormEvent } from 'react';

import { Button, Modal } from '@/components/ui';
import type { CostLinkPickerData } from '@/server/cost/item-link-types';

import { CostLinkPicker, materialLabel, NO_SUGGESTION_TEXT } from './CostLinkPicker';
import {
  confirmCostLinksAction,
  deleteCostLinkAction,
  loadCostLinkPickerAction,
} from './link-actions';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: CostLinkPickerData }
  | { kind: 'error'; message: string };

export const COST_LINK_LOAD_FAILED = '매핑 정보를 불러오지 못했습니다. 다시 시도하세요.';
export const COST_LINK_OUT_OF_SCOPE_NOTICE = '후보 밖 — 원가 비중에 쓰이지 않음';
const LINKS_PATH = '/admin/costs/links';
const FORM_ID = 'policy-cost-link-form';

/** 영향 안내 (policy-cost-link-column §2.3-4) */
export function costLinkImpactText(priceRows: number, normalPriceRows: number): string {
  return `이 품목의 가격 행 ${priceRows}건에 같은 매핑이 적용되고, 원가 비중은 정상판매 ${normalPriceRows}건에 반영됩니다(해당 시기 원가가 없으면 '—').`;
}

export type CostLinkSaved = { itemCode: string; priceRows: number };

export type CostLinkEditModalProps = {
  /** 연 칸의 품목코드 — 같은 품목의 모든 가격 행이 같은 매핑을 쓴다 */
  itemCode: string;
  onClose: () => void;
  /** 확정·해제 성공 — 호출 측이 모달을 닫고 router.refresh·안내·포커스 복귀를 한다 */
  onSaved: (saved: CostLinkSaved) => void;
};

/**
 * 가격정책 관리 '원가 매핑' 칸의 매핑 수정 모달 (policy-cost-link-column §2.3). 열릴 때 1회 조회(다시 시도 = 재요청).
 * 저장·해제는 #53 매핑 화면과 같은 Action(후보 범위·원가표 검사·감사) — 서버 오류는 모달 안 role="alert".
 * 후보 밖·링크 있음 품목은 해제만. 원가 금액은 없다. 닫기·포커스 복귀(연 버튼)는 공용 Modal 규칙.
 */
export function CostLinkEditModal({ itemCode, onClose, onSaved }: CostLinkEditModalProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState('');
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void loadCostLinkPickerAction({ itemCode }).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) return setState({ kind: 'error', message: result.error.message });
        const { data } = result;
        // 초기 선택 = 현재 매핑 → 없으면 제안 (§2.3-3)
        setChosen(data.link?.materialCode ?? data.suggestion?.materialCode ?? '');
        setState({ kind: 'ready', data });
      },
      () => {
        if (!cancelled) setState({ kind: 'error', message: COST_LINK_LOAD_FAILED });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [itemCode, attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  const data = state.kind === 'ready' ? state.data : null;
  const current = data?.link?.materialCode ?? null;
  const removeOnly = data !== null && !data.item.inScope;
  const unchanged = chosen === '' || chosen === current;

  const run = (call: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>) => {
    if (!data || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (!result.ok) return setError(result.error.message);
      onSaved({ itemCode: data.item.itemCode, priceRows: data.impact.priceRows });
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!data || removeOnly || unchanged) return;
    run(() =>
      confirmCostLinksAction({ links: [{ itemCode: data.item.itemCode, materialCode: chosen }] }),
    );
  };

  const remove = () => run(() => deleteCostLinkAction({ itemCode: data!.item.itemCode }));

  const footer = !data ? (
    <Button size="sm" onClick={onClose}>
      취소
    </Button>
  ) : removing ? (
    <>
      <Button size="sm" onClick={() => setRemoving(false)} disabled={pending}>
        취소
      </Button>
      <Button size="sm" variant="danger" onClick={remove} disabled={pending}>
        해제
      </Button>
    </>
  ) : (
    <>
      <Button size="sm" onClick={onClose}>
        취소
      </Button>
      {data.link ? (
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            setError(null);
            setRemoving(true);
          }}
          disabled={pending}
        >
          매핑 해제
        </Button>
      ) : null}
      {removeOnly ? null : (
        <Button
          size="sm"
          variant="primary"
          type="submit"
          form={FORM_ID}
          disabled={unchanged || pending}
        >
          확정
        </Button>
      )}
    </>
  );

  return (
    <Modal open onClose={onClose} title="원가 매핑" size="md" footer={footer}>
      {state.kind === 'loading' ? (
        <p role="status" className="m-0 text-[13px] text-text-tertiary">
          불러오는 중…
        </p>
      ) : state.kind === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-red-600">
          <span>{state.message}</span>
          <Button size="sm" onClick={retry}>
            다시 시도
          </Button>
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="flex min-w-0 flex-col gap-3 text-[13px]">
          <Summary data={state.data} />
          {removing ? (
            <p className="m-0">
              <strong className="text-ink-900">
                {state.data.item.itemName} ({state.data.item.itemCode})
              </strong>
              의 원가 매핑을 해제합니다.
            </p>
          ) : removeOnly ? (
            <p className="m-0 text-[12px] text-amber-700">{COST_LINK_OUT_OF_SCOPE_NOTICE}</p>
          ) : (
            <>
              <CostLinkPicker
                materials={state.data.materials}
                chosen={chosen}
                onChosenChange={setChosen}
                currentCode={state.data.link?.materialCode ?? null}
                suggestedCode={state.data.suggestion?.materialCode ?? null}
                disabled={pending}
              />
              <p className="m-0 text-[12px] text-text-secondary">
                {costLinkImpactText(state.data.impact.priceRows, state.data.impact.normalPriceRows)}
              </p>
            </>
          )}
          {error ? (
            <p role="alert" className="m-0 text-[12px] text-red-600">
              {error}
            </p>
          ) : null}
          <Link
            href={LINKS_PATH}
            className="self-start text-[12px] font-semibold text-purple-600 hover:underline"
          >
            매핑 화면에서 보기
          </Link>
        </form>
      )}
    </Modal>
  );
}

function Summary({ data }: { data: CostLinkPickerData }) {
  const { item, link, suggestion, noSuggestion } = data;
  const rows: [string, string][] = [
    ['품명', item.itemName],
    ['품번', item.itemCode],
    ['제품군', item.family ?? '—'],
    ['소분류', item.categoryMinor ?? '—'],
    ['상태', item.itemStatus ?? '—'],
    ['현재 매핑', link ? materialLabel(link.materialCode, link.materialName) : '없음'],
  ];
  if (item.inScope) {
    rows.push([
      '제안',
      suggestion
        ? materialLabel(suggestion.materialCode, suggestion.materialName)
        : noSuggestion
          ? NO_SUGGESTION_TEXT[noSuggestion]
          : '—',
    ]);
  }
  return (
    <dl aria-label="품목 요약" className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-tertiary">{label}</dt>
          <dd className="m-0 min-w-0 break-all text-ink-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
