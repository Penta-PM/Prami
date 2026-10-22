'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type ReactNode } from 'react';

import { Button, ErpPathHint, Pill } from '@/components/ui';
import { ERP_HINT_COST_LINK } from '@/lib/constants/erp-guide';
import type { CostLinkPair } from '@/lib/imports/cost-link-file';
import {
  COST_LINK_IMPORT_REASON_TEXT,
  COST_LINK_IMPORT_REASONS,
  type ApplyCostLinkImportResult,
  type CostLinkImportEntry,
  type CostLinkImportPreview,
} from '@/server/cost/item-link-types';

import { materialLabel } from './CostLinkPicker';
import { readCostLinkFile } from './cost-link-file-reader';
import { applyCostLinkImportAction, previewCostLinkImportAction } from './link-actions';

/**
 * 품목-원가 매칭 파일 업로드 (스펙 erp-upload-guide §6.2, cost.write 만).
 *
 * 기밀(최우선): 파일은 **이 브라우저에서만** 읽고, 서버로는 {품번, 원자재품번} 쌍만 보낸다(파일·파일명·다른 열 없음).
 * 쌍과 미리보기 목록은 이 컴포넌트 메모리에만 있고 저장(localStorage 등)하지 않는다.
 * 흐름: 파일 선택 → 미리보기(건수 + 접는 목록) → "확정(변경 N·추가 M)" → 결과. 해제는 하지 않는다.
 */

type Loaded = { pairs: CostLinkPair[]; rowCount: number; skipped: number };
type Problem = { text: string; stale?: boolean };

const LABEL = '매칭 파일 업로드';

const SECTION =
  'flex flex-col gap-2.5 rounded-lg bg-surface-card px-3.5 py-2.5 shadow-(--hairline-default)';

function count(n: number) {
  return n.toLocaleString('ko-KR');
}

function List({ title, total, children }: { title: string; total: number; children: ReactNode }) {
  if (total === 0) return null;
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer font-semibold text-text-secondary">
        {title} {count(total)}건 보기
      </summary>
      <ul className="m-0 mt-1.5 flex max-h-[240px] list-none flex-col gap-1 overflow-y-auto p-0 text-text-secondary">
        {children}
      </ul>
    </details>
  );
}

function entryText(entry: CostLinkImportEntry) {
  const after = materialLabel(entry.after.materialCode, entry.after.materialName);
  const before = entry.before
    ? materialLabel(entry.before.materialCode, entry.before.materialName)
    : null;
  return `${entry.itemCode} ${entry.itemName} · ${before ? `${before} → ` : ''}${after}`;
}

export function CostLinkImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const noteId = useId();
  const [reading, setReading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [preview, setPreview] = useState<CostLinkImportPreview | null>(null);
  const [result, setResult] = useState<ApplyCostLinkImportResult | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = reading || isPending;

  const reset = () => {
    setLoaded(null);
    setPreview(null);
    setResult(null);
    setProblem(null);
  };

  const runPreview = (next: Loaded) => {
    setProblem(null);
    setPreview(null);
    startTransition(async () => {
      const response = await previewCostLinkImportAction({ pairs: next.pairs });
      if (!response.ok) {
        setProblem({ text: response.error.message });
        return;
      }
      setPreview(response.data);
    });
  };

  const onFile = async (file: File) => {
    reset();
    setReading(true);
    try {
      const read = await readCostLinkFile(file);
      if (!read.ok) {
        setProblem({ text: read.message });
        return;
      }
      const next = { pairs: read.pairs, rowCount: read.rowCount, skipped: read.skipped };
      setLoaded(next);
      runPreview(next);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const apply = () => {
    if (!loaded || !preview) return;
    setProblem(null);
    startTransition(async () => {
      const response = await applyCostLinkImportAction({
        pairs: loaded.pairs,
        expected: { changed: preview.changed.length, added: preview.added.length },
      });
      if (!response.ok) {
        setProblem({ text: response.error.message, stale: response.error.details?.stale === true });
        return;
      }
      setResult(response.data);
      setPreview(null);
      setLoaded(null);
      router.refresh();
    });
  };

  const changes = preview ? preview.changed.length + preview.added.length : 0;
  const failedTotal = preview ? preview.failed.length : 0;
  const keptTotal = preview ? preview.kept.reduce((sum, row) => sum + row.count, 0) : 0;

  return (
    <section aria-labelledby={`${noteId}-title`} className={SECTION}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold">
          <span id={`${noteId}-title`}>{LABEL}</span>
          <ErpPathHint
            label={LABEL}
            item={ERP_HINT_COST_LINK.item}
            path={ERP_HINT_COST_LINK.path}
          />
        </span>
        <span id={noteId} className="sr-only">
          {`${ERP_HINT_COST_LINK.item}: ${ERP_HINT_COST_LINK.path}`}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="품목-원가 매칭 파일 선택"
          aria-describedby={noteId}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <Button
          size="sm"
          disabled={busy}
          aria-describedby={noteId}
          onClick={() => inputRef.current?.click()}
        >
          {reading ? '읽는 중…' : isPending && !preview ? '확인 중…' : '매칭 파일 선택'}
        </Button>
        <span className="text-[12px] text-text-tertiary">
          파일은 이 브라우저에서만 읽고 품번·원자재품번만 확인합니다. 파일은 저장되지 않습니다.
        </span>
      </div>

      <div role="status" aria-live="polite">
        {result ? (
          <p className="m-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700">
            {`${count(result.saved)}건 확정 (변경 없음 ${count(result.unchanged)}건`}
            {COST_LINK_IMPORT_REASONS.some((reason) => result.failedByReason[reason] > 0)
              ? ` · 미적용 ${count(
                  COST_LINK_IMPORT_REASONS.reduce(
                    (sum, reason) => sum + result.failedByReason[reason],
                    0,
                  ),
                )}건`
              : ''}
            )
          </p>
        ) : null}
      </div>
      {problem ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-600"
        >
          <span>{problem.text}</span>
          {problem.stale && loaded ? (
            <Button size="sm" disabled={busy} onClick={() => runPreview(loaded)}>
              다시 미리보기
            </Button>
          ) : null}
        </div>
      ) : null}

      {preview && loaded ? (
        <div className="flex flex-col gap-2" aria-label="매칭 파일 미리보기" role="group">
          <p className="m-0 text-[12px] text-text-tertiary">
            {`파일 ${count(loaded.rowCount)}행 · 빈 품번·원자재품번으로 건너뜀 ${count(loaded.skipped)}행 · 품목 ${count(preview.items)}개`}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill>같음 {count(preview.same)}</Pill>
            <Pill tone="purple">변경 {count(preview.changed.length)}</Pill>
            <Pill tone="positive">추가 {count(preview.added.length)}</Pill>
            <Pill tone={failedTotal > 0 ? 'amber' : 'neutral'}>실패 {count(failedTotal)}</Pill>
            <Pill>파일에 없는 기존 링크 {count(keptTotal)} (유지)</Pill>
          </div>
          {failedTotal > 0 ? (
            <p className="m-0 text-[12px] text-text-secondary">
              실패 사유:{' '}
              {COST_LINK_IMPORT_REASONS.filter((reason) => preview.failedByReason[reason] > 0)
                .map(
                  (reason) =>
                    `${COST_LINK_IMPORT_REASON_TEXT[reason]} ${count(preview.failedByReason[reason])}`,
                )
                .join(' · ')}
              {' — 적용하지 않습니다'}
            </p>
          ) : null}
          {keptTotal > 0 ? (
            <p className="m-0 text-[12px] text-text-secondary">
              파일에 없는 기존 링크(해제하지 않음):{' '}
              {preview.kept
                .map((row) => `${row.family ?? '품목 없음·후보 범위 밖'} ${count(row.count)}`)
                .join(' · ')}
            </p>
          ) : null}
          <List title="변경" total={preview.changed.length}>
            {preview.changed.map((entry) => (
              <li key={entry.itemCode}>{entryText(entry)}</li>
            ))}
          </List>
          <List title="추가" total={preview.added.length}>
            {preview.added.map((entry) => (
              <li key={entry.itemCode}>{entryText(entry)}</li>
            ))}
          </List>
          <List title="실패" total={failedTotal}>
            {preview.failed.map((failure, index) => (
              <li key={`${failure.itemCode}-${index}`}>
                {`${failure.itemCode} · ${failure.materialCodes.join(', ')} · ${COST_LINK_IMPORT_REASON_TEXT[failure.reason]}`}
              </li>
            ))}
          </List>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
              취소
            </Button>
            <Button size="sm" variant="primary" disabled={busy || changes === 0} onClick={apply}>
              {isPending
                ? '확정 중…'
                : `확정(변경 ${count(preview.changed.length)}·추가 ${count(preview.added.length)})`}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
