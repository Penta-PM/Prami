'use client';

import { useState } from 'react';

import { Button, Select } from '@/components/ui';
import type { ChatDefaultsView, VendorView } from '@/server/llm/credentials/settings';

import { CHAT_LLM_COMING_SOON } from './labels';

/**
 * 챗봇 기본값 (PRAMI-002 §4.6.1 ③, AC-208): 벤더는 본인 키가 **정상** 인 벤더만, 모델은 그 벤더의 상수 목록만.
 * 서버(updateChatDefaults)가 같은 규칙을 다시 검사한다.
 */
export function ChatDefaultsForm({
  vendors,
  validVendorIds,
  defaults,
  busy,
  onSave,
}: {
  vendors: VendorView[];
  validVendorIds: readonly string[];
  defaults: ChatDefaultsView;
  busy: boolean;
  onSave: (vendor: string, model: string) => Promise<void>;
}) {
  const selectable = vendors.filter((vendor) => validVendorIds.includes(vendor.id));
  const initialVendor =
    defaults.vendor && validVendorIds.includes(defaults.vendor)
      ? defaults.vendor
      : (selectable[0]?.id ?? '');
  const [vendorId, setVendorId] = useState(initialVendor);
  const models = vendors.find((vendor) => vendor.id === vendorId)?.models ?? [];
  const [model, setModel] = useState(
    defaults.model && models.some((option) => option.id === defaults.model)
      ? defaults.model
      : (models[0]?.id ?? ''),
  );

  return (
    <section
      aria-labelledby="defaults-title"
      className="flex flex-col gap-4 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="defaults-title" className="m-0 text-[15px] font-semibold">
          챗봇 기본값
        </h2>
        <span className="text-[12px] text-text-tertiary">{CHAT_LLM_COMING_SOON}</span>
      </div>
      {selectable.length === 0 ? (
        <p className="m-0 text-[13px] text-text-tertiary">
          정상 검증된 LLM 키가 있어야 기본 벤더를 고를 수 있습니다.
        </p>
      ) : (
        <form
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(vendorId, model);
          }}
        >
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-text-secondary">
            기본 벤더
            <Select
              value={vendorId}
              onChange={(event) => {
                const next = event.target.value;
                setVendorId(next);
                setModel(vendors.find((vendor) => vendor.id === next)?.models[0]?.id ?? '');
              }}
            >
              {selectable.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-text-secondary">
            모델
            <Select value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.tierLabel}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="primary" disabled={busy || !model}>
            기본값 저장
          </Button>
          <p className="m-0 text-[12px] text-text-tertiary sm:col-span-3">
            상위 모델일수록 요금이 큽니다. 요금은 본인 벤더 계정에 청구됩니다.
          </p>
        </form>
      )}
    </section>
  );
}
