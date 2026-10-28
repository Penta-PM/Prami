'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ChatDomain } from '@/lib/chat/conversations';

import { deleteConversation, fetchConversations, renameConversation, type ApiResult } from './api';
import type { ConversationSummary } from './types';

export type ListStatus = 'loading' | 'ready' | 'error';

/**
 * 저장 대화 목록 (UX PR-C2): 처음 마운트 시 조회(스켈레톤), 전송·생성 뒤 refresh 로 다시 읽어 제목(자동)·순서(최근 순)를 반영한다.
 * 이름 바꾸기·삭제는 서버 응답 뒤 목록에 바로 반영한다(이름 바꾸기는 순서를 바꾸지 않음 — 서버와 같음).
 */
export function useConversationList(domain: ChatDomain) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');

  const refresh = useCallback(async () => {
    const result = await fetchConversations(domain);
    if (result.ok) {
      setItems(result.data);
      setStatus('ready');
    } else {
      // 이미 목록이 있으면 그대로 두고(새로 고침 실패), 처음 조회 실패만 오류 상태로
      setStatus((current) => (current === 'ready' ? current : 'error'));
    }
  }, [domain]);

  useEffect(() => {
    // 조회 결과는 비동기 콜백에서 반영한다 (effect 본문에서 동기 setState 없음)
    const first = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(first);
  }, [refresh]);

  const retry = useCallback(() => {
    setStatus('loading');
    void refresh();
  }, [refresh]);

  const rename = useCallback(
    async (id: string, title: string): Promise<ApiResult<ConversationSummary>> => {
      const result = await renameConversation(id, title);
      if (result.ok) {
        setItems((list) =>
          list.map((item) => (item.id === id ? { ...item, title: result.data.title } : item)),
        );
      }
      return result;
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    const result = await deleteConversation(id);
    // 이미 없는 대화(404)도 목록에서 뺀다 — 다른 탭에서 지운 경우
    if (result.ok || result.status === 404) {
      setItems((list) => list.filter((item) => item.id !== id));
    }
    return result.ok || result.status === 404
      ? ({ ok: true } as const)
      : ({ ok: false, message: result.message } as const);
  }, []);

  return { items, status, refresh, retry, rename, remove };
}
