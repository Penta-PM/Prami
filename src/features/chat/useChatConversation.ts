'use client';

import { useEffect, useRef, useState } from 'react';

import { askChatStream } from './chatStream';
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
  /** 패널이 닫히면 진행 중인 스트림을 중단한다 (벤더 과금 절감, §4.3.9) */
  isOpen?: boolean;
};

export function useChatConversation({ status, applyLlm, onReply, isOpen = true }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), from: 'bot', text: GREETING },
  ]);
  const [isSending, setSending] = useState(false);
  const shownSetup = useRef<string | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const push = (message: Omit<ChatMessage, 'id'>) => {
    const id = nextId();
    setMessages((list) => [...list, { id, ...message }]);
    return id;
  };
  const patch = (id: string, update: (message: ChatMessage) => Partial<ChatMessage>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...update(m) } : m)));

  // 상태 조회로 설정이 필요하면 첫 봇 메시지(인사말)에 안내를 붙인다 (한 번 — 말풍선 수는 그대로)
  useEffect(() => {
    const setup = status?.setup;
    if (!setup || shownSetup.current === setup.status) return;
    shownSetup.current = setup.status;
    setMessages((list) =>
      list.map((message, index) => (index === 0 ? { ...message, setup } : message)),
    );
  }, [status?.setup]);

  useEffect(() => {
    if (!isOpen) inflight.current?.abort();
  }, [isOpen]);

  /** 최종 응답 → 봇 말풍선 필드 (JSON·SSE final 공통) */
  const replyFields = (data: ChatReplyView): Omit<ChatMessage, 'id'> => {
    // 원가 거부(precheck)는 자격 증명 확인 전에 끝나 llm 이 기본값이다 — 배너·상태를 갱신하지 않는다 (r4 §4.3.11)
    if (!(data.mode === 'refusal' && data.intent === 'cost')) applyLlm(data.llm);
    const repeated = data.setup && shownSetup.current === data.setup.status;
    if (data.setup && !repeated) shownSetup.current = data.setup.status;
    return {
      from: 'bot',
      text: data.reply,
      intent: data.intent,
      action: data.action,
      notice: data.notice,
      footnote: repeated && data.setup?.status === 'missing' ? MISSING_SHORT : undefined,
      setup: repeated ? undefined : data.setup,
      exchange: true,
      statusLabel: undefined,
      streaming: false,
    };
  };

  /** LLM 연결 상태: SSE 로 받아 말풍선을 점진 갱신, final 로 교체 */
  const sendStreaming = async (text: string, history: ChatHistoryItem[]) => {
    const controller = new AbortController();
    inflight.current = controller;
    const id = push({ from: 'bot', text: '', streaming: true });
    const result = await askChatStream(text, history, controller.signal, {
      onToken: (token) => patch(id, (m) => ({ text: m.text + token, statusLabel: undefined })),
      onStatus: (label) => patch(id, () => ({ statusLabel: label })),
    });
    inflight.current = null;
    if (!result.ok) {
      patch(id, () => ({
        text: result.message,
        tone: 'error',
        streaming: false,
        statusLabel: undefined,
      }));
      return null;
    }
    patch(id, () => replyFields(result.data));
    return result.data;
  };

  const send = async (text: string) => {
    const ready = status?.llm.status === 'ready';
    const history = ready ? buildHistory(messages) : undefined;
    push({ from: 'user', text, exchange: true });
    setSending(true);
    if (ready) {
      const data = await sendStreaming(text, history ?? []);
      setSending(false);
      if (data) onReply(data);
      return;
    }
    const result = await askChat(text, history);
    setSending(false);
    if (!result.ok) return void push({ from: 'bot', text: result.message, tone: 'error' });
    push(replyFields(result.data));
    onReply(result.data);
  };

  return { messages, isSending, send };
}
