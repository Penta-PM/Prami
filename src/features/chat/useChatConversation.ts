'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ChatHistoryItem,
  ChatLlmView,
  ChatMessage,
  ChatReplyView,
  ChatStatusView,
} from './types';

/**
 * 챗봇 대화 상태 (PRAMI-001 §4.5.9 + PRAMI-002 §4.3.7·§4.9). 대화는 React 메모리에만 — 저장하지 않는다.
 * - 최근 대화(history)는 **LLM 연결 상태일 때만** 보낸다(규칙 엔진은 쓰지 않음). 최대 10턴, 텍스트만.
 * - 설정 안내는 첫 번째에만 전체 문구, 같은 안내가 반복되면 짧은 notice 한 줄.
 */
export const GREETING =
  '안녕하세요! WAPPLES, D.AMO, iSIGN, Cloudbric 가격정책과 견적에 대해 무엇이든 물어보세요.';
export const MISSING_SHORT = 'LLM 미연결 — 기본 응답';
export const HISTORY_TURNS = 10;

let messageSeq = 0;
const nextId = () => `m${(messageSeq += 1)}`;

type AskResult = { ok: true; data: ChatReplyView } | { ok: false; message: string };

export async function askChat(message: string, history?: ChatHistoryItem[]): Promise<AskResult> {
  try {
    const body = history && history.length > 0 ? { message, history } : { message };
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as
      { ok: true; data: ChatReplyView } | { ok: false; error: { message: string } };
    if (json.ok) return json;
    return { ok: false, message: json.error.message };
  } catch {
    return { ok: false, message: '챗봇 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export function buildHistory(messages: readonly ChatMessage[]): ChatHistoryItem[] {
  return messages
    .filter((message) => message.exchange && message.text.trim())
    .map((message) => ({
      role: message.from === 'user' ? ('user' as const) : ('assistant' as const),
      text: message.text.slice(0, 1000),
    }))
    .slice(-HISTORY_TURNS);
}

type Options = {
  status: ChatStatusView | null;
  applyLlm: (llm: ChatLlmView | undefined) => void;
  onReply: (data: ChatReplyView) => void;
};

export function useChatConversation({ status, applyLlm, onReply }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), from: 'bot', text: GREETING },
  ]);
  const [isSending, setSending] = useState(false);
  const shownSetup = useRef<string | null>(null);
  const push = (message: Omit<ChatMessage, 'id'>) =>
    setMessages((list) => [...list, { id: nextId(), ...message }]);

  // 상태 조회로 설정이 필요하면 첫 봇 메시지(인사말)에 안내를 붙인다 (한 번 — 말풍선 수는 그대로)
  useEffect(() => {
    const setup = status?.setup;
    if (!setup || shownSetup.current === setup.status) return;
    shownSetup.current = setup.status;
    setMessages((list) =>
      list.map((message, index) => (index === 0 ? { ...message, setup } : message)),
    );
  }, [status?.setup]);

  const send = useCallback(
    async (text: string) => {
      const history = status?.llm.status === 'ready' ? buildHistory(messages) : undefined;
      push({ from: 'user', text, exchange: true });
      setSending(true);
      const result = await askChat(text, history);
      setSending(false);
      if (!result.ok) return push({ from: 'bot', text: result.message, tone: 'error' });
      const { data } = result;
      applyLlm(data.llm);
      const repeated = data.setup && shownSetup.current === data.setup.status;
      if (data.setup && !repeated) shownSetup.current = data.setup.status;
      push({
        from: 'bot',
        text: data.reply,
        intent: data.intent,
        action: data.action,
        notice: data.notice,
        footnote: repeated && data.setup?.status === 'missing' ? MISSING_SHORT : undefined,
        setup: repeated ? undefined : data.setup,
        exchange: true,
      });
      onReply(data);
    },
    [messages, status, applyLlm, onReply],
  );

  return { messages, isSending, send };
}
