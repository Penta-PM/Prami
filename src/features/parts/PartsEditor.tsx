'use client';

import { m } from 'motion/react';
import { useState } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Input } from '@/components/ui';
import { Icon } from '@/features/shell/icons';
import { cn } from '@/lib/cn';
import { VARIANT_KEYS, scaleIn, transition } from '@/lib/motion/tokens';

import type { CatalogItemView } from './types';

type PartsEditorProps = {
  models: readonly CatalogItemView[];
  parts: readonly CatalogItemView[];
  /** 이미 매핑이 있는 모델 품번 (AC-31 경고·"등록됨" 표시) */
  mappedModels: ReadonlySet<string>;
  selectedModel: string | null;
  checked: ReadonlySet<string>;
  editing: boolean;
  isPending: boolean;
  onSelectModel: (itemCode: string) => void;
  onToggle: (itemCode: string, on: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
};

const matches = (item: CatalogItemView, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || item.itemName.toLowerCase().includes(q) || item.itemCode.toLowerCase().includes(q);
};

/** 수동 등록 (디자인 파츠 관리 좌/우 2단): 모델 선택 → 장착 가능 파츠 다중 선택 → 선택 칩 → 저장 */
export function PartsEditor(props: PartsEditorProps) {
  const { models, parts, mappedModels, selectedModel, checked, editing, isPending } = props;
  const [modelQuery, setModelQuery] = useState('');
  const [partQuery, setPartQuery] = useState('');
  const model = models.find((item) => item.itemCode === selectedModel) ?? null;
  const selected = parts.filter((item) => checked.has(item.itemCode));
  const duplicate = selectedModel !== null && mappedModels.has(selectedModel);

  return (
    <section
      aria-label="수동 등록"
      className="mb-7 flex flex-col gap-4 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <h2 className="m-0 text-[13px] font-semibold text-text-tertiary">
        {editing && model ? `매핑 수정 · ${model.itemName}` : '신규 매핑 등록'}
      </h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ModelPicker
          models={models.filter((item) => matches(item, modelQuery))}
          mappedModels={mappedModels}
          selectedModel={selectedModel}
          query={modelQuery}
          onQuery={setModelQuery}
          onSelect={props.onSelectModel}
        />
        <PartsChecklist
          parts={parts.filter((item) => matches(item, partQuery))}
          checked={checked}
          query={partQuery}
          onQuery={setPartQuery}
          onToggle={props.onToggle}
        />
      </div>
      {model ? (
        <div className="border-t border-border-subtle pt-4">
          <p className="m-0 mb-2 text-[12px] font-medium text-text-secondary">
            선택된 파츠 ({selected.length})
          </p>
          <div className="flex flex-wrap gap-1.5" aria-label="선택된 파츠">
            {/* 선택 칩 추가·해제 (Motion 도입 스펙 §3.3 클라이언트 목록). 가로 flex-wrap 칩이라 height 접힘 대신
                scaleIn(0.96↔1 + fade)으로 나타나고 사라지며, 나머지 칩은 layout 으로 재배치된다.
                Presence initial={false} 라 모델을 고를 때 이미 체크된 칩은 애니메이션 없이 최종 상태 */}
            <Presence>
              {selected.map((item) => (
                <m.span
                  key={item.itemCode}
                  layout
                  variants={scaleIn}
                  initial={VARIANT_KEYS.initial}
                  animate={VARIANT_KEYS.animate}
                  exit={VARIANT_KEYS.exit}
                  transition={{ layout: transition.layout }}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-gray-100 py-1 pr-1.5 pl-3 text-[12px] font-medium"
                >
                  {item.itemName}
                  <button
                    type="button"
                    aria-label={`${item.itemName} 선택 해제`}
                    className="border-0 bg-transparent px-1 text-text-tertiary hover:text-ink-900"
                    onClick={() => props.onToggle(item.itemCode, false)}
                  >
                    ×
                  </button>
                </m.span>
              ))}
            </Presence>
            {selected.length === 0 ? (
              <span className="text-[12px] text-text-tertiary">선택된 파츠가 없습니다.</span>
            ) : null}
          </div>
          <Presence>
            {duplicate ? (
              <Collapse key="duplicate" role="alert">
                <p className="m-0 mt-2.5 rounded-lg bg-amber-500/15 px-3 py-2.5 text-[12px] font-medium text-amber-500">
                  이미 등록된 모델입니다. 기존 파츠를 체크 상태로 불러왔으며, 저장하면 현재 선택으로
                  전체 교체됩니다.
                </p>
              </Collapse>
            ) : null}
          </Presence>
        </div>
      ) : null}
      <div className="flex gap-2">
        {editing ? (
          <Button className="flex-1" onClick={props.onCancel}>
            취소
          </Button>
        ) : null}
        <Button
          className="flex-[2]"
          variant="primary"
          disabled={!model || selected.length === 0 || isPending}
          onClick={props.onSave}
        >
          {editing ? '매핑 수정 저장' : '저장'}
        </Button>
      </div>
    </section>
  );
}

function ModelPicker({
  models,
  mappedModels,
  selectedModel,
  query,
  onQuery,
  onSelect,
}: {
  models: readonly CatalogItemView[];
  mappedModels: ReadonlySet<string>;
  selectedModel: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (itemCode: string) => void;
}) {
  return (
    <div>
      <label className="mb-2.5 flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text-secondary">모델 선택</span>
        <Input
          type="search"
          value={query}
          placeholder="모델명으로 검색"
          aria-label="모델 검색"
          leading={<Icon name="search" className="size-4" />}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <ul
        aria-label="모델 목록"
        className="m-0 flex max-h-[340px] list-none flex-col gap-1.5 overflow-y-auto p-0"
      >
        {models.map((item) => {
          const active = item.itemCode === selectedModel;
          return (
            <li key={item.itemCode}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${item.itemName} (${item.itemCode})`}
                onClick={() => onSelect(item.itemCode)}
                className={cn(
                  'w-full rounded-[10px] border-0 px-3 py-2.5 text-left text-[13px]',
                  active
                    ? 'bg-lime-500 font-semibold text-ink-900'
                    : 'bg-transparent font-medium shadow-(--hairline-subtle) hover:bg-gray-75',
                )}
              >
                {item.itemName}
                <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">
                  {item.itemCode}
                </span>
                {mappedModels.has(item.itemCode) ? (
                  <span className="ml-1.5 text-[10px] font-semibold text-purple-600">· 등록됨</span>
                ) : null}
              </button>
            </li>
          );
        })}
        {models.length === 0 ? (
          <li className="p-3 text-center text-[12px] text-text-tertiary">검색 결과가 없습니다.</li>
        ) : null}
      </ul>
    </div>
  );
}

function PartsChecklist({
  parts,
  checked,
  query,
  onQuery,
  onToggle,
}: {
  parts: readonly CatalogItemView[];
  checked: ReadonlySet<string>;
  query: string;
  onQuery: (value: string) => void;
  onToggle: (itemCode: string, on: boolean) => void;
}) {
  return (
    <div>
      <label className="mb-2.5 flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text-secondary">
          장착 가능한 파츠 (다중 선택)
        </span>
        <Input
          type="search"
          value={query}
          placeholder="파츠명, 품번으로 검색"
          aria-label="파츠 검색"
          leading={<Icon name="search" className="size-4" />}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <div
        role="group"
        aria-label="파츠 목록"
        className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto"
      >
        {parts.map((item) => (
          <label
            key={item.itemCode}
            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium shadow-(--hairline-subtle)"
          >
            <input
              type="checkbox"
              checked={checked.has(item.itemCode)}
              onChange={(event) => onToggle(item.itemCode, event.target.checked)}
            />
            <span className="flex-1">{item.itemName}</span>
            <span className="text-[11px] text-text-tertiary">{item.itemCode}</span>
          </label>
        ))}
        {parts.length === 0 ? (
          <p className="m-0 text-[12px] text-text-tertiary">해당 조건의 파츠가 없습니다.</p>
        ) : null}
      </div>
    </div>
  );
}
