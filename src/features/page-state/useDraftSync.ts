'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { DraftRestoreMap } from '@/features/calculator/types';
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_VERSIONS,
  stableStringify,
  type DraftKey,
  type DraftOf,
} from '@/lib/page-state/drafts';

import { deleteDraftAction, readDraftAction, saveDraftAction } from './draft-actions';

export type DraftSyncOptions<K extends DraftKey> = {
  draftKey: K;
  /** 지금 화면의 초안 값 — null = 빈 상태(저장할 것이 없음 → 서버 초안 삭제) */
  value: DraftOf<K> | null;
  /** 서버에 이 초안 행이 있는가 (복원했으면 true) */
  hasServerDraft: boolean;
  /** 복원 직후 화면 값이 저장값과 달라졌다(최신가 갱신·제외·단계 멈춤) — 첫 값도 저장한다 */
  persistInitial?: boolean;
  /** 탭이 다시 보일 때 다른 탭이 저장한 초안을 받았다 (편집 중이 아닐 때만, 값이 다를 때만) */
  onRemote?: (restored: DraftRestoreMap[K]) => void;
  /** 복원 형태 → 초안 값 (화면 값과 같은 함수) — 다른 탭 초안이 지금 값과 같으면 반영하지 않는다 */
  toValue?: (restored: DraftRestoreMap[K]) => DraftOf<K> | null;
};

const noop = () => undefined;

/**
 * 입력 초안 서버 저장 (page-state-memory §2.4-2·5, §2.6-2). 화면에는 아무것도 그리지 않는다.
 * - 값이 바뀌면 1s 뒤 저장(디바운스). 빈 상태(null)가 되면 서버 초안을 지운다. 화면 이탈·탭 숨김 때 남은 저장은 바로 보낸다.
 * - 여러 탭: 마지막 저장 우선. 탭이 다시 보일 때(visibilitychange) 편집 중(저장 대기)이 아니면 서버 초안을 다시 읽어 반영한다.
 * - `discard()`: '새로 시작'·'견적 초기화' — 대기 중인 저장을 버리고 서버 초안을 바로 지운다(이어서 화면을 빈 상태로 되돌리면 다시 저장하지 않는다).
 * user_id·검증·원가 필드 제거는 서버 액션·저장소가 한다.
 */
export function useDraftSync<K extends DraftKey>({
  draftKey,
  value,
  hasServerDraft,
  persistInitial = false,
  onRemote,
  toValue,
}: DraftSyncOptions<K>): { discard: () => void } {
  const serialized = value === null ? null : stableStringify(value);
  // 마지막으로 서버와 맞춘 값 (undefined = 아직 모름 → 첫 값도 저장)
  const lastSentRef = useRef<string | null | undefined>(persistInitial ? undefined : serialized);
  const serverHasRef = useRef(hasServerDraft);
  const valueRef = useRef(value);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteRef = useRef({ onRemote, toValue });

  useEffect(() => {
    remoteRef.current = { onRemote, toValue };
  }, [onRemote, toValue]);

  const send = useCallback(() => {
    pendingRef.current = null;
    const current = valueRef.current;
    lastSentRef.current = current === null ? null : stableStringify(current);
    if (current === null) {
      if (!serverHasRef.current) return;
      serverHasRef.current = false;
      void deleteDraftAction({ draftKey }).catch(noop);
      return;
    }
    serverHasRef.current = true;
    void saveDraftAction({ draftKey, version: DRAFT_VERSIONS[draftKey], data: current }).catch(
      noop,
    );
  }, [draftKey]);

  const cancelPending = () => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = null;
  };

  // ── 값 변경 → 디바운스 저장 ───────────────────────────────────────────
  useEffect(() => {
    valueRef.current = value;
    cancelPending();
    if (serialized === lastSentRef.current) return;
    pendingRef.current = setTimeout(send, DRAFT_SAVE_DEBOUNCE_MS);
    // value 는 serialized 로 대표된다 (같은 내용의 새 객체로는 다시 저장하지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, send]);

  // ── 이탈 저장 · 탭 재표시 다시 읽기 ──────────────────────────────────
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        send();
      }
    };
    let active = true;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return flush();
      // 편집 중(저장 대기)이면 내 입력이 우선 — 다시 읽지 않는다
      if (pendingRef.current || !remoteRef.current.onRemote) return;
      void readDraftAction({ draftKey })
        .then((result) => {
          if (!active || pendingRef.current || !result.ok || !result.data) return;
          const { onRemote: apply, toValue: convert } = remoteRef.current;
          const next = convert ? convert(result.data) : undefined;
          const json =
            next === undefined ? undefined : next === null ? null : stableStringify(next);
          serverHasRef.current = true;
          if (json !== undefined && json === lastSentRef.current) return;
          // 받은 값이 새 기준 — 반영으로 바뀐 화면 값은 다시 저장하지 않는다
          if (json !== undefined) lastSentRef.current = json;
          apply?.(result.data);
        })
        .catch(noop);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [draftKey, send]);

  const discard = useCallback(() => {
    cancelPending();
    lastSentRef.current = null;
    serverHasRef.current = false;
    void deleteDraftAction({ draftKey }).catch(noop);
  }, [draftKey]);

  return { discard };
}
