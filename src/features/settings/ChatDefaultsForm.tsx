'use client';

import { useState } from 'react';

import { Button, Pill, Select } from '@/components/ui';
import type { ChatDefaultsView, VendorView } from '@/server/llm/credentials/settings';

import { CHAT_DEFAULTS_CAPTION, MODEL_REPLACED_NOTICE, MODEL_UNAVAILABLE_LABEL } from './labels';

type ModelOption = VendorView['models'][number];
/** 정상 키가 있는 벤더 → 이 키로 쓸 수 있는 모델 (null = 미확인, 상수 전체 허용) */
export type AvailableModels = Record<string, readonly string[] | null>;

/**
 * 챗봇 기본값 (PRAMI-002 §4.6.1 ③, AC-208 r2): 벤더는 본인 키가 **정상** 인 벤더만, 모델은 그 벤더의 상수 목록만.
 * 검증에서 확인된 사용 가능 모델(available_models) 밖은 "이 키로 사용 불가"로 비활성, 레거시는 '레거시' 배지.
 * 서버(updateChatDefaults)가 같은 규칙을 다시 검사한다.
 */
type PickerProps = {
  vendors: VendorView[];
  available: AvailableModels;
  defaults: ChatDefaultsView;
  busy: boolean;
  onSave: (vendor: string, model: string) => Promise<void>;
};

export function ChatDefaultsForm(props: PickerProps) {
  const hasSelectable = props.vendors.some((vendor) => vendor.id in props.available);
  return (
    <section
      aria-labelledby="defaults-title"
      className="flex flex-col gap-4 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="defaults-title" className="m-0 text-[15px] font-semibold">
          챗봇 기본값
        </h2>
        <span className="text-[12px] text-text-tertiary">{CHAT_DEFAULTS_CAPTION}</span>
      </div>
      {props.defaults.modelReplaced ? (
        <p role="status" className="m-0 rounded-lg bg-amber-500/15 px-3.5 py-2.5 text-[13px]">
          {MODEL_REPLACED_NOTICE}
        </p>
      ) : null}
      {hasSelectable ? (
        <DefaultsPicker {...props} />
      ) : (
        <p className="m-0 text-[13px] text-text-tertiary">
          정상 검증된 LLM 키가 있어야 기본 벤더를 고를 수 있습니다.
        </p>
      )}
    </section>
  );
}

function DefaultsPicker({ vendors, available, defaults, busy, onSave }: PickerProps) {
  const selectable = vendors.filter((vendor) => vendor.id in available);
  const modelsOf = (id: string) => vendors.find((vendor) => vendor.id === id)?.models ?? [];
  const usableIn = (id: string) => (option: ModelOption) => isUsable(option, available[id]);
  const [vendorId, setVendorId] = useState(() =>
    defaults.vendor && defaults.vendor in available ? defaults.vendor : (selectable[0]?.id ?? ''),
  );
  const [model, setModel] = useState(() =>
    initialModel(
      modelsOf(vendorId),
      usableIn(vendorId),
      defaults.vendor === vendorId ? defaults.model : null,
    ),
  );

  return (
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
            setModel(initialModel(modelsOf(next), usableIn(next), null));
          }}
        >
          {selectable.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.label}
            </option>
          ))}
        </Select>
      </label>
      <ModelField
        models={modelsOf(vendorId)}
        usable={usableIn(vendorId)}
        value={model}
        onChange={setModel}
      />
      <Button type="submit" variant="primary" disabled={busy || !model}>
        기본값 저장
      </Button>
      <p className="m-0 text-[12px] text-text-tertiary sm:col-span-3">
        상위 모델일수록 요금이 큽니다. 요금은 본인 벤더 계정에 청구됩니다.
      </p>
    </form>
  );
}

function ModelField({
  models,
  usable,
  value,
  onChange,
}: {
  models: readonly ModelOption[];
  usable: (option: ModelOption) => boolean;
  value: string;
  onChange: (model: string) => void;
}) {
  const selected = models.find((option) => option.id === value);
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-text-secondary">
      <span className="flex items-center gap-1.5">
        모델
        {selected?.lifecycleLabel ? (
          <Pill tone="amber" data-testid="legacy-badge">
            {selected.lifecycleLabel}
          </Pill>
        ) : null}
      </span>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {models.map((option) => (
          <option key={option.id} value={option.id} disabled={!usable(option)}>
            {optionLabel(option, usable(option))}
          </option>
        ))}
      </Select>
    </label>
  );
}

function isUsable(option: ModelOption, availableIds: readonly string[] | null | undefined) {
  return !availableIds || availableIds.includes(option.id);
}

/** 저장값이 쓸 수 있으면 그대로, 아니면 벤더 기본 모델(쓸 수 있을 때) → 첫 사용 가능 모델 */
function initialModel(
  models: readonly ModelOption[],
  usable: (option: ModelOption) => boolean,
  saved: string | null,
): string {
  const savedOption = models.find((option) => option.id === saved);
  if (savedOption && usable(savedOption)) return savedOption.id;
  const fallback = models.find((option) => option.isDefault && usable(option));
  return fallback?.id ?? models.find(usable)?.id ?? '';
}

/** 네이티브 option 에는 배지를 넣을 수 없어 텍스트로 표시하고, 선택된 레거시는 옆에 Pill 배지를 보인다 */
function optionLabel(option: ModelOption, usable: boolean): string {
  const parts = [option.label, option.tierLabel];
  if (option.lifecycleLabel) parts.push(option.lifecycleLabel);
  const text = parts.join(' · ');
  return usable ? text : `${text} — ${MODEL_UNAVAILABLE_LABEL}`;
}
