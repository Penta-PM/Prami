'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';

import { Button, Drawer, Input } from '@/components/ui';
import {
  DELIVERY_EDIT_FIELDS,
  DELIVERY_HISTORY_LIMIT,
  deliveryFormText,
  parseDeliveryFieldValue,
  type DeliveryFieldKey,
} from '@/features/procurement/admin/deliveries/fields';
import type { ActionError } from '@/lib/result';
import type { DeliveryDetail } from '@/server/procurement/deliveries';

import { getDeliveryDetailAction, updateDeliveryAction } from './actions';
import { DeliveryConfirmModal } from './DeliveryConfirmModal';
import {
  deliveryName,
  formChanges,
  historyChangeTexts,
  historyTime,
  isStaleError,
  type DeliveryFormChange,
} from './display';

type FormValues = Record<DeliveryFieldKey, string>;

function formOf(detail: DeliveryDetail): FormValues {
  return Object.fromEntries(
    DELIVERY_EDIT_FIELDS.map((field) => [field.key, deliveryFormText(detail.values[field.key])]),
  ) as FormValues;
}

/** 편집 요청 — seq 는 같은 행을 다시 열 때도 새로 읽게 하는 열기 번호 */
export type DeliveryEditRequest = { id: number; seq: number };

export type DeliveryEditorProps = {
  /** 편집할 행 (null = 닫힘 — 드로어 퇴장 동안 마지막 내용을 유지한다) */
  request: DeliveryEditRequest | null;
  onClose: () => void;
  /** 저장됨 (바뀐 칸 수) */
  onSaved: (changed: number) => void;
  /** 이미 처리됨 — 편집을 연 뒤 다른 사람이 바꿨거나 휴지통으로 옮겼다 */
  onStale: () => void;
};

type Loaded =
  | { seq: number; detail: DeliveryDetail; error?: undefined }
  | { seq: number; detail?: undefined; error: string };

function nameOf(detail: DeliveryDetail): string {
  return deliveryName({
    dlvrReqNo: String(detail.values.dlvrReqNo ?? ''),
    changeOrd: String(detail.values.changeOrd ?? ''),
  });
}

/**
 * 납품요구 편집 (조달이 통합 UI-6) — 드로어에 전 필드(원본 편집 화면과 같은 칸·순서) + 최근 변경 이력 10건.
 * 저장은 바뀐 칸 목록을 확인 모달로 보여 준 뒤 서버 액션(동시 편집 재검증 — 연 시점 값과 현재 값이 다르면 "이미 처리됨").
 * 확인 모달은 드로어 밖(형제)에 그린다 — 드로어의 Esc·Tab 처리(React 트리로 올라오는 keydown)가 모달 키 입력을 가로채지 않게.
 */
export function DeliveryEditor({ request, onClose, onSaved, onStale }: DeliveryEditorProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DeliveryFormChange[] | null>(null);
  const [, startTransition] = useTransition();
  const staleRef = useRef(onStale);
  useEffect(() => {
    staleRef.current = onStale;
  }, [onStale]);

  const requestId = request?.id ?? null;
  const requestSeq = request?.seq ?? null;
  useEffect(() => {
    if (requestId === null || requestSeq === null) return;
    let active = true;
    startTransition(async () => {
      const result = await getDeliveryDetailAction({ id: requestId });
      if (!active) return;
      setFieldErrors({});
      setMessage(null);
      setConfirming(null);
      if (!result.ok) {
        if (isStaleError(result.error)) staleRef.current();
        else setLoaded({ seq: requestSeq, error: result.error.message });
        return;
      }
      if (result.data.excluded) {
        staleRef.current();
        return;
      }
      setLoaded({ seq: requestSeq, detail: result.data });
      setForm(formOf(result.data));
    });
    return () => {
      active = false;
    };
  }, [requestId, requestSeq]);

  // 열려 있으면 그 요청의 내용만, 닫히는 중이면 마지막 내용
  const visible = request ? (loaded?.seq === request.seq ? loaded : null) : loaded;
  const detail = visible?.detail ?? null;

  const close = () => {
    setConfirming(null);
    onClose();
  };

  const change = (key: DeliveryFieldKey, value: string) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !form) return;
    const errors: Record<string, string[]> = {};
    for (const field of DELIVERY_EDIT_FIELDS) {
      const parsed = parseDeliveryFieldValue(field, form[field.key]);
      if (!parsed.ok) errors[field.key] = [parsed.message];
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMessage('입력값을 확인하세요.');
      return;
    }
    const changes = formChanges(detail.values, form);
    if (changes.length === 0) {
      setMessage('바뀐 내용이 없습니다.');
      return;
    }
    setMessage(null);
    setConfirming(changes);
  };

  const handleSaved = (result: Awaited<ReturnType<typeof updateDeliveryAction>>): boolean => {
    if (result.ok) {
      setConfirming(null);
      onSaved(result.data.changed);
      return true;
    }
    const error: ActionError = result.error;
    if (isStaleError(error)) {
      setConfirming(null);
      onStale();
      return true;
    }
    if (error.code === 'VALIDATION' && error.fieldErrors) {
      setConfirming(null);
      setFieldErrors(error.fieldErrors);
      setMessage(error.message);
      return true;
    }
    return false;
  };

  const title = detail ? `납품요구 수정 · ${nameOf(detail)}` : '납품요구 수정';
  const loadError = visible?.error ?? null;

  return (
    <>
      <Drawer open={request !== null} onClose={close} title={title} width={680}>
        {loadError ? (
          <p role="alert" className="m-0 text-[13px] text-red-600">
            {loadError}
          </p>
        ) : !detail || !form ? (
          <p role="status" className="m-0 text-[13px] text-text-tertiary">
            불러오는 중…
          </p>
        ) : (
          <form
            aria-label="납품요구 수정"
            onSubmit={submit}
            noValidate
            className="flex flex-col gap-4"
          >
            <p className="m-0 text-[13px] text-text-tertiary">
              고친 내용은 바로 저장돼 조달 통계에 반영되고, 누가 무엇을 바꿨는지 이력이 남아요.
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {DELIVERY_EDIT_FIELDS.map((field) => {
                const errors = fieldErrors[field.key];
                const errorId = `delivery-field-error-${field.key}`;
                return (
                  <label key={field.key} className="flex min-w-0 flex-col gap-1">
                    <span className="text-[13px] font-semibold text-text-secondary">
                      {field.label}
                    </span>
                    <Input
                      name={field.key}
                      type={field.type === 'date' ? 'date' : 'text'}
                      inputMode={
                        field.type === 'int' || field.type === 'num' ? 'decimal' : undefined
                      }
                      value={form[field.key]}
                      onChange={(event) => change(field.key, event.target.value)}
                      aria-invalid={errors ? true : undefined}
                      aria-describedby={errors ? errorId : undefined}
                      className={
                        field.type === 'int' || field.type === 'num' ? 'tabular-nums' : undefined
                      }
                    />
                    {errors ? (
                      <span id={errorId} className="text-[12px] text-red-600">
                        {errors[0]}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            {message ? (
              <p role="alert" className="m-0 text-[13px] text-red-600">
                {message}
              </p>
            ) : null}
            <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-border-subtle bg-surface-card px-6 py-3">
              <Button type="button" size="sm" onClick={close}>
                취소
              </Button>
              <Button type="submit" size="sm" variant="primary">
                저장
              </Button>
            </div>
            <DeliveryHistoryList history={detail.history} />
          </form>
        )}
      </Drawer>
      {confirming && request && detail && form ? (
        <DeliveryConfirmModal
          title="변경 저장"
          confirmLabel="저장"
          action={() =>
            updateDeliveryAction({ id: detail.id, values: form, expected: detail.values })
          }
          onDone={handleSaved}
          onClose={() => setConfirming(null)}
        >
          <p className="m-0">
            {nameOf(detail)} 의 {confirming.length}개 칸을 저장합니다.
          </p>
          <ul aria-label="바뀐 칸" className="m-0 mt-2 flex flex-col gap-1 pl-5 text-[13px]">
            {confirming.map((item) => (
              <li key={item.key}>
                <span className="font-semibold text-ink-900">{item.label}</span>: {item.from} →{' '}
                {item.to}
              </li>
            ))}
          </ul>
        </DeliveryConfirmModal>
      ) : null}
    </>
  );
}

/** 최근 변경 이력 (최신순, 최대 10건) */
function DeliveryHistoryList({ history }: { history: DeliveryDetail['history'] }) {
  return (
    <section
      aria-label="변경 이력"
      className="flex flex-col gap-2 border-t border-border-subtle pt-3"
    >
      <h3 className="m-0 text-[14px] font-bold text-ink-900">
        변경 이력{' '}
        <span className="text-[12px] font-normal text-text-tertiary">
          (최근 {DELIVERY_HISTORY_LIMIT}건)
        </span>
      </h3>
      {history.length === 0 ? (
        <p className="m-0 text-[13px] text-text-tertiary">아직 변경 이력이 없습니다.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {history.map((entry) => (
            <li key={entry.id} className="text-[13px] leading-relaxed text-text-secondary">
              <span className="tabular-nums">{historyTime(entry.changedAt)}</span> ·{' '}
              {entry.changedBy ?? '—'} · {historyChangeTexts(entry.before, entry.after).join(', ')}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
