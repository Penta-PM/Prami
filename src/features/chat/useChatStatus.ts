'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ChatLlmView, ChatStatusView } from './types';

/**
 * LLM 연결 상태 (PRAMI-002 §4.9): 패널이 열릴 때와 탭 포커스 복귀 시 `GET /api/chat/status` 를 다시 부른다.
 * 설정에서 키를 저장한 뒤 새로고침 없이 반영된다. 응답의 llm 으로도 갱신한다(예: 키가 무효로 바뀐 경우).
 * 상태는 React 메모리에만 둔다 — 브라우저 Web Storage 에 쓰지 않는다(§4.3.7).
 */
export function useChatStatus(endpoint: string | undefined, isOpen: boolean) {
  const [status, setStatus] = useState<ChatStatusView | null>(null);

  const refresh = useCallback(async () => {
    if (!endpoint) return;
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const body = (await response.json()) as { ok: boolean; data?: ChatStatusView };
      if (body.ok && body.data) setStatus(body.data);
    } catch {
      // 상태를 못 받아도 챗봇은 동작한다 (서버가 요청마다 판정)
    }
  }, [endpoint]);

  useEffect(() => {
    if (!isOpen || !endpoint) return;
    // 조회 결과는 비동기 콜백에서 반영한다 (effect 본문에서 동기 setState 없음)
    const first = setTimeout(() => void refresh(), 0);
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      clearTimeout(first);
    };
  }, [isOpen, endpoint, refresh]);

  /** 응답의 llm 상태로 갱신 (설정 안내는 상태 조회 때만 새로 받는다) */
  const applyLlm = useCallback((llm: ChatLlmView | undefined) => {
    if (!llm) return;
    setStatus((current) =>
      current && current.llm.status === llm.status
        ? current
        : { llm, ruleFallback: current?.ruleFallback ?? true },
    );
  }, []);

  return { status, applyLlm, refresh };
}
