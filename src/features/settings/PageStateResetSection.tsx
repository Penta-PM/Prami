'use client';

import { useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Modal } from '@/components/ui';
import { clearSavedPageStateAction } from '@/features/page-state/draft-actions';

/** 안내 문구 (page-state-memory §2.6-3 — 표 열 레이아웃은 대상이 아님을 밝힌다) */
export const PAGE_STATE_RESET_NOTICE =
  "조회 조건과 작성 중 입력을 지웁니다. 표 열 너비·순서는 각 표의 '열 초기화'로 되돌립니다";

type Flash = { tone: 'ok' | 'error'; text: string };

/**
 * 사용자 설정 > 저장된 화면·입력 초기화 (page-state-memory §2.6-3). 확인 모달 후 본인의 조회 상태(user_view_states)·
 * 입력 초안(user_drafts) 을 모두 지운다. 표 열 너비·순서(#32, 브라우저 localStorage)는 건드리지 않는다.
 */
export function PageStateResetSection() {
  const [confirming, setConfirming] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () =>
    startTransition(async () => {
      const result = await clearSavedPageStateAction();
      setConfirming(false);
      setFlash(
        result.ok
          ? { tone: 'ok', text: '저장된 화면·입력을 초기화했습니다' }
          : { tone: 'error', text: result.error.message },
      );
    });

  return (
    <section
      aria-labelledby="page-state-reset-title"
      className="flex flex-col gap-3 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <h2 id="page-state-reset-title" className="m-0 text-[15px] font-semibold">
        저장된 화면·입력 초기화
      </h2>
      <p className="m-0 text-[13px] text-text-secondary">{PAGE_STATE_RESET_NOTICE}</p>
      <Presence>
        {flash ? (
          <Collapse key="flash" role={flash.tone === 'error' ? 'alert' : 'status'}>
            <p
              className={
                flash.tone === 'error'
                  ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-600'
                  : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700'
              }
            >
              {flash.text}
            </p>
          </Collapse>
        ) : null}
      </Presence>
      <div>
        <Button onClick={() => setConfirming(true)}>저장된 화면·입력 초기화</Button>
      </div>
      <Modal open={confirming} onClose={() => setConfirming(false)} title="저장된 화면·입력 초기화">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[13px]">{PAGE_STATE_RESET_NOTICE}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirming(false)}>취소</Button>
            <Button variant="danger" disabled={isPending} onClick={reset}>
              초기화
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
