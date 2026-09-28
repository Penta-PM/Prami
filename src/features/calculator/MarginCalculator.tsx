'use client';

import { useState, useTransition } from 'react';

import { Button, Input } from '@/components/ui';
import { calculateNetSalesAction } from '@/features/costs/actions';
import { formatAmount } from '@/lib/pricing/format';

type Result = Extract<Awaited<ReturnType<typeof calculateNetSalesAction>>, { ok: true }>['data'];

type Values = {
  sellingPrice: string;
  quantity: string;
  discountRate: string;
  unitCost: string;
  miscCost: string;
};

const INITIAL: Values = {
  sellingPrice: '',
  quantity: '1',
  discountRate: '0',
  unitCost: '',
  miscCost: '0',
};

const won = (value: string | undefined) => (value === undefined ? '—' : `${formatAmount(value)}원`);

/**
 * 순매출 계산기 (§4.5.7, AC-64). 원가 입력은 USER 에게 잠금("관리자만 조회 가능")이고 서버(PR-5 `calculateNetSalesAction`)가
 * 역할로 다시 판단해 USER 응답에는 원가·이익 값이 없다. ADMIN 은 원가·이익률이 계산된다.
 */
export function MarginCalculator({ canSeeCost }: { canSeeCost: boolean }) {
  const [values, setValues] = useState<Values>(INITIAL);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (key: keyof Values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const calculate = () =>
    startTransition(async () => {
      const response = await calculateNetSalesAction({
        sellingPrice: Number(values.sellingPrice),
        quantity: Number(values.quantity),
        discountRate: Number(values.discountRate),
        unitCost: canSeeCost && values.unitCost !== '' ? Number(values.unitCost) : null,
        miscCost: Number(values.miscCost) || 0,
      });
      if (!response.ok) {
        setError(response.error.message);
        setResult(null);
        return;
      }
      setError(null);
      setResult(response.data);
    });

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[13px] text-text-tertiary">
        판매가격, 할인, 원가를 입력하면 실제 순매출과 이익률을 계산합니다.
      </p>
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-2">
        <section
          aria-label="입력값"
          className="flex flex-col gap-4 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
        >
          <h2 className="m-0 text-[13px] font-semibold text-text-tertiary">입력값</h2>
          <Field label="정상 판매가 (단가)">
            <Input
              name="sellingPrice"
              inputMode="decimal"
              value={values.sellingPrice}
              onChange={(e) => set('sellingPrice', e.target.value)}
            />
          </Field>
          <Field label="판매 수량">
            <Input
              name="quantity"
              inputMode="numeric"
              value={values.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          </Field>
          <Field label="할인율 (%)">
            <Input
              name="discountRate"
              inputMode="decimal"
              value={values.discountRate}
              onChange={(e) => set('discountRate', e.target.value)}
            />
          </Field>
          <Field label="원가 (단가)">
            {canSeeCost ? (
              <Input
                name="unitCost"
                inputMode="decimal"
                value={values.unitCost}
                onChange={(e) => set('unitCost', e.target.value)}
              />
            ) : (
              <div
                role="status"
                aria-label="원가 잠금"
                className="rounded-xl bg-gray-75 px-3.5 py-2.5 text-[13px] text-text-tertiary"
              >
                관리자만 조회 가능
              </div>
            )}
          </Field>
          <Field label="기타 비용">
            <Input
              name="miscCost"
              inputMode="decimal"
              value={values.miscCost}
              onChange={(e) => set('miscCost', e.target.value)}
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-500"
            >
              {error}
            </p>
          ) : null}
          <Button
            variant="primary"
            disabled={isPending || values.sellingPrice === ''}
            onClick={calculate}
          >
            계산
          </Button>
        </section>
        <section
          aria-label="순매출 결과"
          className="flex flex-col gap-3.5 rounded-2xl bg-ink-900 p-7 text-white"
        >
          <span className="text-[13px] font-semibold text-lime-500">순매출</span>
          <strong className="text-[32px] font-bold" data-testid="margin-net">
            {result
              ? won(
                  result.cost
                    ? result.cost.profit
                    : String(Number(result.netAmount) - Number(result.miscAmount)),
                )
              : '—'}
          </strong>
          <dl className="m-0 flex flex-col gap-2.5 border-t border-white/12 pt-4 text-[13px]">
            <Row label="정상 판매금액" value={result ? won(result.grossAmount) : '—'} />
            <Row label="할인 금액" value={result ? `− ${won(result.discountAmount)}` : '—'} />
            <Row label="실제 판매금액" value={result ? won(result.netAmount) : '—'} />
            <Row
              label="원가"
              value={canSeeCost ? (result ? won(result.cost?.totalCost) : '—') : '비공개'}
            />
            <Row label="기타 비용" value={result ? `− ${won(result.miscAmount)}` : '—'} />
            <Row
              label="이익률"
              value={canSeeCost ? (result?.cost ? `${result.cost.marginRate}%` : '—') : '비공개'}
            />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-white/60">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  );
}
