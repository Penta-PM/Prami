'use client';

import { useRef, useState, type ReactNode } from 'react';

import { Button, Segmented, Select } from '@/components/ui';
import { checkUploadFiles, PLATFORM_TOO_LARGE_MESSAGE } from '@/lib/constants/upload-limits';
import { formatDate } from '@/lib/date-format';

import type {
  BatchOption,
  FileMode,
  FileSelection,
  ImportFileKind,
  UploadSummaryData,
} from './types';
import { UploadSummary } from './UploadSummary';

const MODE_OPTIONS = [
  { value: 'new', label: '신규 업로드' },
  { value: 'reuse', label: '기존 파일 재사용' },
] as const;

type ImportFileRowProps = {
  kind: ImportFileKind;
  label: string;
  uploadLabel: string;
  options: readonly BatchOption[];
  selection: FileSelection;
  onChange: (next: FileSelection) => void;
  /** 품목조회처럼 선택 사항이면 "없음"을 허용한다 */
  optional?: boolean;
  /** 여러 파일을 한 배치로 (품목조회 1~5개, PRAMI-003 §4.2.3) */
  multiple?: boolean;
  note?: ReactNode;
};

type UploadResponse =
  | { ok: true; data: UploadSummaryData }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: { existingBatchId?: string; errors?: UploadSummaryData['errors'] };
      };
    };

const STATUS_LABELS: Record<BatchOption['status'], string> = {
  parsed: '미적용',
  applied: '현재 적용',
  superseded: '이전 적용',
  failed: '실패',
};

/** JSON 봉투가 아닌 응답(플랫폼 413 등)도 사용자 문구로 바꾼다 */
async function readUploadResponse(response: Response): Promise<UploadResponse> {
  try {
    return (await response.json()) as UploadResponse;
  } catch {
    const message =
      response.status === 413
        ? PLATFORM_TOO_LARGE_MESSAGE
        : `업로드하지 못했습니다 (HTTP ${response.status}). 잠시 후 다시 시도하세요`;
    return { ok: false, error: { code: 'HTTP', message } };
  }
}

function optionLabel(option: BatchOption): string {
  // 업로드일은 한국 시간 기준 (UTC 문자열 slice 는 KST 00~09시 업로드를 전날로 표시했다 — Linux 하이드레이션 수정 스펙 §3.3)
  const date = formatDate(option.createdAt);
  return `${option.fileName} · ${date} · ${option.rowCount.toLocaleString('ko-KR')}행 · ${STATUS_LABELS[option.status]}`;
}

/** 파일 1행 (디자인 "판매단가 파일" / "품목상태 파일"): 신규 업로드 ↔ 기존 파일 재사용 토글 (R-11) */
export function ImportFileRow(props: ImportFileRowProps) {
  const { kind, label, uploadLabel, options, selection, onChange, optional = false } = props;
  const { multiple = false, note } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<UploadSummaryData['errors']>([]);
  const [existingId, setExistingId] = useState<string | null>(null);

  const upload = async (files: File[]) => {
    setMessage(null);
    setFileErrors([]);
    setExistingId(null);
    // 상한 초과는 보내기 전에 알린다 — 큰 본문이 플랫폼·proxy 에서 잘려 원인 없는 오류가 되는 것을 막는다 (QA M-2)
    const tooLarge = checkUploadFiles(files, multiple);
    if (tooLarge) {
      setMessage(tooLarge);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      if (multiple) for (const file of files) body.append('files', file);
      else body.set('file', files[0]!);
      const response = await fetch(`/api/imports/${kind}`, { method: 'POST', body });
      const json = await readUploadResponse(response);
      if (json.ok) onChange({ ...selection, upload: json.data });
      else {
        setMessage(json.error.message);
        setFileErrors(json.error.details?.errors ?? []);
        setExistingId(json.error.details?.existingBatchId ?? null);
      }
    } catch {
      setMessage('업로드하지 못했습니다. 네트워크 상태를 확인하세요');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-surface-card px-3.5 py-2.5 shadow-(--hairline-default)">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="w-[110px] text-[12px] font-semibold">{label}</span>
        <Segmented
          aria-label={`${label} 방식`}
          options={MODE_OPTIONS}
          value={selection.mode}
          onChange={(mode: FileMode) => onChange({ ...selection, mode })}
        />
        {selection.mode === 'new' ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label={uploadLabel}
              className="sr-only"
              multiple={multiple}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length > 0) void upload(files);
              }}
            />
            <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? '검증 중…' : uploadLabel}
            </Button>
          </>
        ) : (
          <Select
            aria-label={`${label} 기존 배치`}
            value={selection.reuseId}
            onChange={(event) => onChange({ ...selection, reuseId: event.target.value })}
            className="w-auto min-w-[320px] py-2 text-[12px]"
          >
            <option value="">
              {optional ? '없음 (품목조회 파일 미적용)' : '파일을 선택하세요'}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {optionLabel(option)}
              </option>
            ))}
          </Select>
        )}
        {note}
      </div>
      {message ? (
        <p role="alert" className="m-0 text-[12px] text-red-500">
          {message}
          {existingId ? (
            <button
              type="button"
              className="ml-2 border-0 bg-transparent p-0 text-[12px] font-semibold text-purple-600 underline"
              onClick={() => onChange({ ...selection, mode: 'reuse', reuseId: existingId })}
            >
              기존 파일 선택
            </button>
          ) : null}
          {fileErrors.length > 0 ? (
            <span className="mt-1 block">
              {fileErrors.slice(0, 10).map((error, index) => (
                <span key={index} className="block">
                  {error.file ? `${error.file} · ` : ''}
                  {error.message}
                </span>
              ))}
            </span>
          ) : null}
        </p>
      ) : null}
      {selection.mode === 'new' && selection.upload ? (
        <UploadSummary kind={kind} data={selection.upload} />
      ) : null}
    </div>
  );
}
