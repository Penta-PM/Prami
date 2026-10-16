'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition, type FormEvent } from 'react';

import { Presence } from '@/components/motion/Presence';
import { Button, Input, Modal, Segmented, Select } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { formatAuditTime } from '@/lib/audit-format';
import { cn } from '@/lib/cn';
import {
  COST_LINK_FAMILIES,
  type CostLinkCandidate,
  type CostLinkFamily,
  type CostLinkMaterial,
  type CostLinkNoSuggestion,
  type CostLinkView,
} from '@/server/cost/item-link-types';

import { confirmCostLinksAction, deleteCostLinkAction } from './link-actions';

/**
 * 원가 매핑 관리 (스펙 cost-ratio-price-change §2.1, ADMIN). 가격 품목코드(P…) ↔ 원가 자재번호(W…).
 * 모델명 휴리스틱 제안은 화면에만 보이고, 관리자가 확정한 쌍만 저장된다. 원가 금액은 이 화면 어디에도 없다.
 */

const TABLE_ID = 'cost-links';
/** 확정 Action 한 번의 상한 — 넘으면 나눠 보낸다 */
const CONFIRM_CHUNK = 500;

const NO_SUGGESTION_TEXT: Record<CostLinkNoSuggestion, string> = {
  'sw-upgrade': 'S/W 업그레이드 — 제안 없음',
  'no-model': '모델을 읽을 수 없음',
  'no-cost': '같은 모델 원가 없음',
};

type FamilyFilter = 'all' | CostLinkFamily;
const FAMILY_OPTIONS: readonly { value: FamilyFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  ...COST_LINK_FAMILIES.map((family) => ({ value: family, label: family })),
];

const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';
const HEADER_CLASS = 'py-[13px] first:pl-5 last:pr-5';
const CELL_CLASS = 'px-3 py-3.5 whitespace-nowrap first:pl-5 last:pr-5';

/** 확정 매핑이 이미 제안과 같은지 */
function linkedToSuggestion(row: CostLinkCandidate): boolean {
  return row.suggestion !== null && row.link?.materialCode === row.suggestion.materialCode;
}

/** 제안이 있는 행만 (품목코드, 제안 자재번호) 쌍으로 */
function suggestedLinks(rows: readonly CostLinkCandidate[]) {
  return rows.flatMap((row) =>
    row.suggestion ? [{ itemCode: row.itemCode, materialCode: row.suggestion.materialCode }] : [],
  );
}

function materialLabel(code: string, name: string | null): string {
  return name === null ? `${code} (원가표에 없음)` : `${name} (${code})`;
}

type Flash = { tone: 'ok' | 'error'; text: string };
type Unlinking = { itemCode: string; label: string };

export type CostLinkManagerProps = {
  view: CostLinkView;
  /** cost.write 가 없으면 읽기 전용 — 선택·확정·해제 컨트롤을 그리지 않는다 */
  canWrite: boolean;
  /** 표 열 너비·순서 저장 키 */
  userId: string;
};

export function CostLinkManager({ view, canWrite, userId }: CostLinkManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [family, setFamily] = useState<FamilyFilter>('all');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<Flash | null>(null);
  const [choosing, setChoosing] = useState<CostLinkCandidate | null>(null);
  const [unlinking, setUnlinking] = useState<Unlinking | null>(null);
  const searchId = useId();

  const { candidates, orphans, materials } = view;

  const selectable = (row: CostLinkCandidate) =>
    canWrite && row.suggestion !== null && !linkedToSuggestion(row);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return candidates.filter(
      (row) =>
        (family === 'all' || row.family === family) &&
        (!unlinkedOnly || row.link === null) &&
        (needle === '' ||
          row.itemCode.toLowerCase().includes(needle) ||
          row.itemName.toLowerCase().includes(needle)),
    );
  }, [candidates, family, unlinkedOnly, query]);

  // 선택은 필터를 바꿔도 유지하되, 실제로 보낼 대상은 지금 제안대로 확정 가능한 행만
  const selectedRows = candidates.filter((row) => selected.has(row.itemCode) && selectable(row));
  const visibleSelectable = visible.filter(selectable);
  const allVisibleSelected =
    visibleSelectable.length > 0 && visibleSelectable.every((row) => selected.has(row.itemCode));

  const counts = {
    total: candidates.length,
    linked: candidates.filter((row) => row.link !== null).length,
    suggested: candidates.filter((row) => row.suggestion !== null).length,
  };

  /** 모달을 열 때 이전 결과 문구는 지운다 (모달 안 오류와 섞이지 않게) */
  const openModal = (open: () => void) => {
    setFlash(null);
    open();
  };

  const toggle = (itemCode: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemCode)) next.delete(itemCode);
      else next.add(itemCode);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of visibleSelectable) {
        if (allVisibleSelected) next.delete(row.itemCode);
        else next.add(row.itemCode);
      }
      return next;
    });

  const confirm = (links: { itemCode: string; materialCode: string }[], after?: () => void) => {
    if (links.length === 0) return;
    setFlash(null);
    startTransition(async () => {
      let saved = 0;
      let unchanged = 0;
      for (let start = 0; start < links.length; start += CONFIRM_CHUNK) {
        const result = await confirmCostLinksAction({
          links: links.slice(start, start + CONFIRM_CHUNK),
        });
        if (!result.ok) {
          setFlash({ tone: 'error', text: result.error.message });
          if (saved + unchanged > 0) router.refresh();
          return;
        }
        saved += result.data.saved;
        unchanged += result.data.unchanged;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const link of links) next.delete(link.itemCode);
        return next;
      });
      after?.();
      setFlash({
        tone: 'ok',
        text: unchanged > 0 ? `${saved}건 확정 (변경 없음 ${unchanged}건)` : `${saved}건 확정`,
      });
      router.refresh();
    });
  };

  const unlink = (itemCode: string) => {
    setFlash(null);
    startTransition(async () => {
      const result = await deleteCostLinkAction({ itemCode });
      if (!result.ok) {
        setFlash({ tone: 'error', text: result.error.message });
        return;
      }
      setUnlinking(null);
      setFlash({ tone: 'ok', text: result.data.deleted ? '1건 해제' : '이미 해제된 매핑입니다' });
      router.refresh();
    });
  };

  const columns: DataTableColumn<CostLinkCandidate>[] = [
    ...(canWrite
      ? [
          {
            id: 'select',
            label: '선택',
            header: (
              <input
                type="checkbox"
                aria-label="보이는 제안 전체 선택"
                checked={allVisibleSelected}
                disabled={visibleSelectable.length === 0 || isPending}
                onChange={toggleAllVisible}
              />
            ),
            type: 'none' as const,
            pinned: 'start' as const,
            resizable: false,
            minWidth: 44,
            headerClassName: HEADER_CLASS,
            cellClassName: CELL_CLASS,
            cell: (row: CostLinkCandidate) =>
              selectable(row) ? (
                <input
                  type="checkbox"
                  aria-label={`${row.itemName} 선택`}
                  checked={selected.has(row.itemCode)}
                  disabled={isPending}
                  onChange={() => toggle(row.itemCode)}
                />
              ) : null,
          },
        ]
      : []),
    {
      id: 'itemCode',
      header: '품목코드',
      type: 'text',
      sortValue: (row) => row.itemCode,
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[12px] text-text-tertiary'),
      cell: (row) => row.itemCode,
    },
    {
      id: 'itemName',
      header: '품목명',
      type: 'text',
      sortValue: (row) => row.itemName,
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[13px] font-semibold text-ink-900'),
      cell: (row) => row.itemName,
    },
    {
      id: 'categoryMinor',
      header: '소분류',
      type: 'text',
      sortValue: (row) => row.categoryMinor,
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[13px] text-text-secondary'),
      cell: (row) => row.categoryMinor ?? '—',
    },
    {
      id: 'itemStatus',
      header: '상태',
      type: 'text',
      sortValue: (row) => row.itemStatus,
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[13px] text-text-secondary'),
      cell: (row) => row.itemStatus ?? '—',
    },
    {
      id: 'hasNormalPrice',
      header: '정상판매',
      type: 'text',
      align: 'center',
      sortValue: (row) => (row.hasNormalPrice ? '있음' : '없음'),
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[12px] text-text-secondary'),
      cell: (row) => (row.hasNormalPrice ? '있음' : '없음'),
    },
    {
      id: 'link',
      header: '확정 원가',
      type: 'text',
      sortValue: (row) => (row.link ? (row.link.materialName ?? row.link.materialCode) : null),
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[13px]'),
      cell: (row) =>
        row.link ? (
          <span className={cn(row.link.materialName === null ? 'text-red-500' : 'text-ink-900')}>
            {materialLabel(row.link.materialCode, row.link.materialName)}
          </span>
        ) : (
          <span className="text-text-tertiary">미확정</span>
        ),
    },
    {
      id: 'suggestion',
      header: '제안',
      type: 'text',
      sortValue: (row) => row.suggestion?.materialName ?? null,
      headerClassName: HEADER_CLASS,
      cellClassName: cn(CELL_CLASS, 'text-[13px]'),
      cell: (row) =>
        row.suggestion ? (
          <span className="text-text-secondary">
            {materialLabel(row.suggestion.materialCode, row.suggestion.materialName)}
          </span>
        ) : (
          <span className="text-[12px] text-text-tertiary">
            {row.noSuggestion ? NO_SUGGESTION_TEXT[row.noSuggestion] : '—'}
          </span>
        ),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: '동작',
            type: 'none' as const,
            pinned: 'end' as const,
            align: 'right' as const,
            headerClassName: HEADER_CLASS,
            cellClassName: CELL_CLASS,
            cell: (row: CostLinkCandidate) => (
              <>
                {row.suggestion && !linkedToSuggestion(row) ? (
                  <button
                    type="button"
                    aria-label={`${row.itemName} 제안대로 확정`}
                    className={`${ACTION} text-purple-600`}
                    disabled={isPending}
                    onClick={() => confirm(suggestedLinks([row]))}
                  >
                    제안대로 확정
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`${row.itemName} 직접 선택`}
                  className={`${ACTION} text-text-secondary`}
                  disabled={isPending}
                  onClick={() => openModal(() => setChoosing(row))}
                >
                  직접 선택
                </button>
                {row.link ? (
                  <button
                    type="button"
                    aria-label={`${row.itemName} 해제`}
                    className={`${ACTION} text-red-500`}
                    disabled={isPending}
                    onClick={() =>
                      openModal(() => setUnlinking({ itemCode: row.itemCode, label: row.itemName }))
                    }
                  >
                    해제
                  </button>
                ) : null}
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="제품군"
          options={FAMILY_OPTIONS}
          value={family}
          onChange={setFamily}
        />
        <label className="flex items-center gap-2 text-[13px] font-medium text-text-secondary">
          <input
            type="checkbox"
            checked={unlinkedOnly}
            onChange={(event) => setUnlinkedOnly(event.target.checked)}
          />
          미확정만
        </label>
        <label htmlFor={searchId} className="sr-only">
          품목코드·품목명 검색
        </label>
        <Input
          id={searchId}
          type="search"
          placeholder="품목코드·품목명 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          wrapperClassName="w-[240px]"
        />
      </div>

      <p className="m-0 text-[12px] text-text-tertiary" aria-label="매핑 요약">
        후보 {counts.total} · 확정 {counts.linked} · 제안 {counts.suggested}
        {visible.length !== counts.total ? ` (표시 ${visible.length})` : ''}
      </p>

      <div role="status" aria-live="polite">
        {flash?.tone === 'ok' ? (
          <p className="m-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700">
            {flash.text}
          </p>
        ) : null}
      </div>
      {flash?.tone === 'error' && !choosing && !unlinking ? (
        <p
          role="alert"
          className="m-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-500"
        >
          {flash.text}
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={selectedRows.length === 0 || isPending}
            onClick={() => confirm(suggestedLinks(selectedRows))}
          >
            선택 {selectedRows.length}건 제안대로 확정
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={TABLE_ID}
          userId={userId}
          columns={columns}
          rows={visible}
          getRowKey={(row) => row.itemCode}
          aria-label="원가 매핑 후보"
          headClassName="bg-gray-75"
        />
        {visible.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-text-tertiary">
            조건에 맞는 품목이 없습니다.
          </div>
        ) : null}
      </div>

      {orphans.length > 0 ? (
        <section aria-labelledby="cost-link-orphans" className="mt-4 flex flex-col gap-2">
          <h2 id="cost-link-orphans" className="m-0 [font:var(--text-h2)]">
            품목 없음 (가격 품목이 사라진 매핑)
          </h2>
          <p className="m-0 text-[12px] text-text-tertiary">
            가격 임포트로 품목이 사라져도 매핑은 자동으로 지우지 않습니다.
          </p>
          <ul className="m-0 flex list-none flex-col gap-0 rounded-[10px] bg-surface-card p-0 shadow-(--hairline-default)">
            {orphans.map((orphan) => (
              <li
                key={orphan.itemCode}
                className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3 text-[13px] last:border-b-0"
              >
                <span className="text-[12px] text-text-tertiary">{orphan.itemCode}</span>
                <span className="text-ink-900">
                  {materialLabel(orphan.materialCode, orphan.materialName)}
                </span>
                <span className="text-[12px] text-text-tertiary">
                  {formatAuditTime(new Date(orphan.updatedAt))}
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    aria-label={`${orphan.itemCode} 해제`}
                    className={`${ACTION} ml-auto text-red-500`}
                    disabled={isPending}
                    onClick={() =>
                      openModal(() =>
                        setUnlinking({ itemCode: orphan.itemCode, label: orphan.itemCode }),
                      )
                    }
                  >
                    해제
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Presence>
        {choosing ? (
          <MaterialPickerModal
            key="picker"
            row={choosing}
            materials={materials}
            pending={isPending}
            error={flash?.tone === 'error' ? flash.text : null}
            onClose={() => setChoosing(null)}
            onConfirm={(materialCode) =>
              confirm([{ itemCode: choosing.itemCode, materialCode }], () => setChoosing(null))
            }
          />
        ) : null}
      </Presence>
      <Presence>
        {unlinking ? (
          <Modal
            key="unlink"
            open
            onClose={() => setUnlinking(null)}
            title="매핑 해제"
            footer={
              <>
                <Button size="sm" onClick={() => setUnlinking(null)}>
                  취소
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isPending}
                  onClick={() => unlink(unlinking.itemCode)}
                >
                  해제
                </Button>
              </>
            }
          >
            <p className="m-0">
              <strong className="text-ink-900">{unlinking.label}</strong>의 원가 매핑을 해제합니다.
            </p>
            {flash?.tone === 'error' ? (
              <p role="alert" className="mt-2 mb-0 text-[12px] text-red-500">
                {flash.text}
              </p>
            ) : null}
          </Modal>
        ) : null}
      </Presence>
    </div>
  );
}

type MaterialPickerModalProps = {
  row: CostLinkCandidate;
  materials: readonly CostLinkMaterial[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (materialCode: string) => void;
};

/** 직접 선택 — 원가 자재 목록(자재명·자재번호)에서 하나를 골라 확정 */
function MaterialPickerModal({
  row,
  materials,
  pending,
  error,
  onClose,
  onConfirm,
}: MaterialPickerModalProps) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState(
    row.link?.materialCode ?? row.suggestion?.materialCode ?? '',
  );
  const searchId = useId();
  const selectId = useId();

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return materials;
    return materials.filter(
      (material) =>
        material.materialName.toLowerCase().includes(needle) ||
        material.materialCode.toLowerCase().includes(needle) ||
        material.materialCode === chosen,
    );
  }, [materials, search, chosen]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen) onConfirm(chosen);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="원가 직접 선택"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            form="cost-link-picker-form"
            disabled={!chosen || pending}
          >
            확정
          </Button>
        </>
      }
    >
      <form id="cost-link-picker-form" onSubmit={submit} className="flex flex-col gap-3">
        <p className="m-0">
          <strong className="text-ink-900">{row.itemName}</strong> ({row.itemCode})
        </p>
        <label htmlFor={searchId} className="text-[12px] font-medium text-text-secondary">
          자재명·자재번호 검색
        </label>
        <Input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label htmlFor={selectId} className="text-[12px] font-medium text-text-secondary">
          원가 자재 ({filtered.length}건)
        </label>
        <Select
          id={selectId}
          size={8}
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          className="pr-3.5"
        >
          {filtered.map((material) => (
            <option key={material.materialCode} value={material.materialCode}>
              {materialLabel(material.materialCode, material.materialName)}
            </option>
          ))}
        </Select>
        {error ? (
          <p role="alert" className="m-0 text-[12px] text-red-500">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
