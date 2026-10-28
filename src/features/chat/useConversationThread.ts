'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatDomain } from '@/lib/chat/conversations';

import { createConversation, fetchConversation } from './api';
import { postChat } from './chatStream';
import { MISSING_SHORT } from './copy';
import type {
  ChatLlmView,
  ChatMessage,
  ChatReplyView,
  ChatStatusView,
  StoredMessageView,
} from './types';

/**
 * 대화 1건의 상태 (UX PR-C2). URL `?c=` 의 대화를 DB 에서 읽어 말풍선으로 그리고, 질문을 저장 대화로 보낸다.
 * - `?c=` 가 없으면 새 대화(빈 화면). 첫 질문을 보낼 때 대화를 만들고(POST) `onCreated` 로 URL 에 id 를 넣는다 —
 *   빈 대화가 목록에 쌓이지 않게 "새 대화" 버튼은 대화를 만들지 않는다.
 * - history 는 보내지 않는다(서버가 DB 에서 읽음). LLM 연결(ready)이면 SSE, 아니면 JSON(규칙 답) — 둘 다 중지(abort) 가능.
 * - 실패·중지한 답은 저장되지 않고 질문만 남는다(서버). "다시 시도"는 그 질문을 다시 보낸다 — 서버가 답 없는 같은 질문을
 *   재사용하므로 질문이 쌓이지 않는다. DB 에서 읽은 대화의 마지막이 답 없는 질문이어도 같은 버튼이 보인다.
 * - 다른 대화로 옮기면(`?c=` 변경) 진행 중인 요청을 중단한다.
 */
export type ThreadLoad = 'ready' | 'loading' | 'error' | 'missing';

type ReplyChips = Pick<ChatReplyView, 'candidates' | 'showProductChips'>;
const NO_CHIPS: ReplyChips = { candidates: [], showProductChips: false };

let messageSeq = 0;
const nextId = () => `m${(messageSeq += 1)}`;
const nowIso = () => new Date().toISOString();

function fromStored(message: StoredMessageView): ChatMessage {
  return {
    id: `s${message.id}`,
    from: message.role === 'user' ? 'user' : 'bot',
    text: message.content,
    action: message.action,
    createdAt: message.createdAt,
  };
}

type Options = {
  domain: ChatDomain;
  /** URL `?c=` (없으면 null = 새 대화) */
  conversationId: string | null;
  status: ChatStatusView | null;
  applyLlm: (llm: ChatLlmView | undefined) => void;
  /** 첫 질문으로 대화를 만들었을 때 — URL 에 id 를 넣고 목록을 다시 읽는다 */
  onCreated: (id: string) => void;
  /** 한 턴이 끝났을 때(성공·실패) — 목록의 제목·순서를 다시 읽는다 */
  onSettled: () => void;
};

export function useConversationThread({
  domain,
  conversationId,
  status,
  applyLlm,
  onCreated,
  onSettled,
}: Options) {
  /** 지금 화면이 보여 주는 대화 (새 대화면 null) */
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  /** 첫 질문으로 방금 만든 대화 — URL 이 따라올 때까지 이전 `?c=`(없음)로 화면을 초기화하지 않는다 */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [load, setLoad] = useState<ThreadLoad>(conversationId ? 'loading' : 'ready');
  const [loadMessage, setLoadMessage] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setSending] = useState(false);
  const [chips, setChips] = useState<ReplyChips>(NO_CHIPS);

  // URL 이 바뀌면 렌더 중에 화면 상태를 맞춘다 (effect 안 동기 setState 없음)
  if (createdId !== null && conversationId === createdId) setCreatedId(null);
  const waitingForUrl = createdId !== null && conversationId !== createdId;
  if (!waitingForUrl && conversationId !== activeId) {
    setActiveId(conversationId);
    setMessages([]);
    setTitle(null);
    setSending(false);
    setChips(NO_CHIPS);
    setLoad(conversationId ? 'loading' : 'ready');
  }

  const activeRef = useRef(activeId);
  const inflight = useRef<{ conversationId: string; controller: AbortController } | null>(null);
  useEffect(() => {
    activeRef.current = activeId;
    // 다른 대화로 옮기면 진행 중인 답을 중단한다(벤더 과금 절감)
    const current = inflight.current;
    if (current && current.conversationId !== activeId) current.controller.abort();
  }, [activeId]);
  useEffect(() => () => inflight.current?.controller.abort(), []);

  useEffect(() => {
    if (load !== 'loading' || !activeId) return;
    const controller = new AbortController();
    void fetchConversation(activeId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setLoad(result.status === 404 ? 'missing' : 'error');
        setLoadMessage(result.message);
        return;
      }
      setTitle(result.data.title);
      setMessages(result.data.messages.map(fromStored));
      setLoad('ready');
    });
    return () => controller.abort();
  }, [activeId, load]);

  const push = (message: Omit<ChatMessage, 'id'>) => {
    const id = nextId();
    setMessages((list) => [...list, { id, ...message }]);
    return id;
  };
  const patch = (id: string, update: (message: ChatMessage) => Partial<ChatMessage>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...update(m) } : m)));

  /** 최종 응답 → 봇 말풍선 필드 (JSON·SSE final 공통) */
  const replyFields = (data: ChatReplyView): Partial<ChatMessage> => {
    // 원가 거부(precheck)는 자격 증명 확인 전에 끝나 llm 이 기본값이다 — 배너·상태를 갱신하지 않는다 (r4 §4.3.11)
    if (!(data.mode === 'refusal' && data.intent === 'cost')) applyLlm(data.llm);
    // 위 배너가 같은 안내를 이미 보이면 말풍선에는 짧은 한 줄만
    const bannerShows = data.setup !== undefined && status?.setup?.status === data.setup.status;
    return {
      text: data.reply,
      intent: data.intent,
      action: data.action,
      notice: data.notice,
      footnote: data.setup?.status === 'missing' ? MISSING_SHORT : undefined,
      setup: bannerShows ? undefined : data.setup,
      statusLabel: undefined,
      streaming: false,
      tone: undefined,
    };
  };

  /** 저장 대화에 질문 1건 — 봇 말풍선을 점진 갱신하고 final 로 교체 */
  const runTurn = async (id: string, text: string) => {
    const controller = new AbortController();
    inflight.current = { conversationId: id, controller };
    const botId = push({ from: 'bot', text: '', streaming: true, createdAt: nowIso() });
    const result = await postChat(
      { message: text, conversationId: id, domain },
      {
        stream: status?.llm.status === 'ready',
        signal: controller.signal,
        handlers: {
          onToken: (token) =>
            patch(botId, (m) => ({ text: m.text + token, statusLabel: undefined })),
          onStatus: (label) => patch(botId, () => ({ statusLabel: label })),
          // 거부 전 부분 출력은 화면 어디에도 남기지 않는다 (final 이 거부 안내로 채운다)
          onDiscard: () => patch(botId, () => ({ text: '' })),
        },
      },
    );
    if (inflight.current?.controller === controller) inflight.current = null;
    // 다른 대화로 옮겨 중단된 요청이면 지금 화면을 건드리지 않는다
    if (activeRef.current !== id) return;
    setSending(false);
    if (result.ok) {
      patch(botId, () => replyFields(result.data));
      setChips({
        candidates: result.data.candidates,
        showProductChips: result.data.showProductChips,
      });
    } else {
      // 중지·오류: 부분 출력은 저장되지 않으므로 화면에서도 버리고 안내로 바꾼다 → "다시 시도"
      patch(botId, () => ({
        text: result.message,
        tone: 'error',
        streaming: false,
        statusLabel: undefined,
      }));
    }
    onSettled();
  };

  const ask = async (text: string, pushUser: boolean) => {
    if (!text || isSending) return;
    setChips(NO_CHIPS);
    if (pushUser) push({ from: 'user', text, createdAt: nowIso() });
    setSending(true);
    let id = activeId;
    if (!id) {
      const created = await createConversation(domain);
      // 만드는 동안 다른 대화로 옮겼으면 그만둔다
      if (activeRef.current !== null) return;
      if (!created.ok) {
        setSending(false);
        push({ from: 'bot', text: created.message, tone: 'error', createdAt: nowIso() });
        return;
      }
      id = created.data.id;
      activeRef.current = id;
      setActiveId(id);
      setCreatedId(id);
      onCreated(id);
    }
    await runTurn(id, text);
  };

  const send = (raw: string) => ask(raw.trim(), true);

  const lastUserIndex = messages.findLastIndex((message) => message.from === 'user');
  const last = messages.at(-1);
  /** 마지막 질문에 답이 없거나(중지·오류·DB 에 질문만 남음) 마지막 말풍선이 오류 */
  const canRetry =
    !isSending &&
    load === 'ready' &&
    lastUserIndex >= 0 &&
    last !== undefined &&
    (last.from === 'user' || last.tone === 'error');

  const retry = () => {
    if (!canRetry) return;
    const question = messages[lastUserIndex]!;
    setMessages((list) => list.slice(0, lastUserIndex + 1));
    void ask(question.text, false);
  };

  const stop = useCallback(() => inflight.current?.controller.abort(), []);
  const reload = useCallback(() => setLoad('loading'), []);

  return {
    activeId,
    load,
    loadMessage,
    title,
    messages,
    isSending,
    chips,
    canRetry,
    send,
    retry,
    stop,
    reload,
  };
}
