'use client';

import Link from 'next/link';
import { m } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import { PRESS_CLASSES } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { slideRight, VARIANT_KEYS } from '@/lib/motion/tokens';

import { useChatPanel } from './ChatContext';
import { BillingNotice, SetupBanner, SetupLink } from './SetupBanner';
import type { ChatMessage, ChatReplyView } from './types';
import { useChatConversation } from './useChatConversation';
import { useChatStatus } from './useChatStatus';

/**
 * 가격정책 챗봇 패널 (§4.5.9, 디자인 chatOpen 패널): 메시지 말풍선, 예시 질문 칩, 제품 퀵칩, 후보 품목 칩, 견적 시작 링크.
 * 서버(POST /api/chat)가 LangGraph(LLM) 또는 규칙 기반으로 답하고 대화는 어디에도 저장하지 않는다 — 패널을 닫아도 세션 동안만 메모리에 남는다.
 * LLM 텍스트는 평문으로만 렌더링한다(마크다운·링크화 없음 — §4.3.10). 링크는 서버 아티팩트 action.href 와 설정 링크뿐.
 */
export const PRODUCT_CHIPS = ['WAPPLES', 'D.AMO', 'iSIGN', 'Cloudbric'] as const;
export const EXAMPLE_QUESTIONS = [
  'Wapples-500 가격 알려줘',
  '작년보다 올랐어?',
  '견적 뽑아줘',
] as const;
export { askChat, GREETING } from './useChatConversation';

export function ChatPanel() {
  const { isOpen, close, launcherRef, statusEndpoint } = useChatPanel();
  const { status, applyLlm } = useChatStatus(statusEndpoint, isOpen);
  const [input, setInput] = useState('');
  const [showProductChips, setShowProductChips] = useState(false);
  const [candidates, setCandidates] = useState<ChatReplyView['candidates']>([]);
  const [billingDismissed, setBillingDismissed] = useState(false);
  const onReply = useCallback((data: ChatReplyView) => {
    setShowProductChips(data.showProductChips);
    setCandidates(data.candidates);
  }, []);
  const conversation = useChatConversation({ status, applyLlm, onReply, isOpen });
  const { messages, isSending } = conversation;
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 새 메시지가 오면 바닥으로
    // jsdom 에는 scrollTo 가 없다
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [messages]);

  // ×·Escape 로 닫으면 포커스를 헤더 챗봇 버튼으로 돌려준다 — 없으면 body 로 빠진다 (#30)
  const closeAndRestoreFocus = useCallback(() => {
    close();
    launcherRef.current?.focus();
  }, [close, launcherRef]);

  // Escape 로 닫기 (#30, Main 결정 A). 모달(<dialog open>)·드로어(aria-modal) 가 열려 있으면 그쪽 Escape 가 우선이다
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      closeAndRestoreFocus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeAndRestoreFocus]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || isSending) return;
    setInput('');
    setShowProductChips(false);
    setCandidates([]);
    await conversation.send(text);
  };

  const askedByUser = messages.some((message) => message.from === 'user');

  // 패널은 slideRight(x 24 + fade) 로 진입·퇴장한다 (Motion 도입 스펙 §3.3 챗 패널). 대화 상태는 이 컴포넌트에 남으므로
  // 패널을 닫았다 열어도 메시지는 유지되고, 메시지 버블 자체에는 모션을 넣지 않는다 (PR-4 범위)
  return (
    <Presence>
      {isOpen ? (
        <m.aside
          key="chat-panel"
          aria-label="가격정책 챗봇"
          variants={slideRight}
          initial={VARIANT_KEYS.initial}
          animate={VARIANT_KEYS.animate}
          exit={VARIANT_KEYS.exit}
          className="fixed top-0 right-0 z-30 flex h-screen w-[min(400px,100vw)] flex-col border-l border-border-subtle bg-surface-page shadow-(--shadow-elevated)"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
            <div>
              <h2 className="m-0 text-[14px] font-semibold">가격정책 챗봇</h2>
              <p className="m-0 text-[11px] text-text-tertiary">원가 데이터는 표시되지 않습니다</p>
            </div>
            <button
              type="button"
              aria-label="챗봇 닫기"
              onClick={closeAndRestoreFocus}
              className="border-0 bg-transparent text-[16px] font-semibold text-text-tertiary hover:text-ink-900"
            >
              ×
            </button>
          </header>
          {status?.setup ? <SetupBanner setup={status.setup} /> : null}
          {status?.llm.status === 'ready' && !billingDismissed ? (
            <BillingNotice onClose={() => setBillingDismissed(true)} />
          ) : null}
          <div
            ref={logRef}
            role="log"
            aria-label="대화"
            aria-live="polite"
            className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4"
          >
            {messages.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
            {isSending ? (
              <p role="status" className="m-0 text-[11px] text-text-tertiary">
                답변을 찾는 중…
              </p>
            ) : null}
            {!askedByUser ? (
              <ChipRow
                label="예시 질문"
                chips={[...EXAMPLE_QUESTIONS]}
                onPick={(chip) => void send(chip)}
              />
            ) : null}
            {showProductChips ? (
              <ChipRow
                label="제품 선택"
                chips={[...PRODUCT_CHIPS]}
                onPick={(chip) => void send(`${chip} 견적`)}
              />
            ) : null}
            {candidates.length > 0 ? (
              <ChipRow
                label="후보 품목"
                chips={candidates.map(
                  (candidate) => `${candidate.itemName.trim()} (${candidate.itemCode})`,
                )}
                onPick={(chip) => void send(chip.replace(/^.*\(([^)]+)\)$/, '$1'))}
              />
            ) : null}
          </div>
          <form
            className="flex gap-2 border-t border-border-subtle px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              aria-label="질문 입력"
              value={input}
              maxLength={200}
              onChange={(event) => setInput(event.target.value)}
              placeholder="예: SA-500 가격이 얼마야?"
              className="flex-1 rounded-xl border-0 bg-surface-card px-3.5 py-2.5 text-[12px] shadow-(--hairline-default) outline-none"
            />
            <Button type="submit" variant="primary" disabled={isSending || input.trim() === ''}>
              보내기
            </Button>
          </form>
        </m.aside>
      ) : null}
    </Presence>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.from === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        data-from={message.from}
        className={
          isUser
            ? 'max-w-[78%] rounded-[14px] bg-ink-900 px-[15px] py-[11px] text-[13px] leading-[1.5] whitespace-pre-line text-white'
            : message.tone === 'error'
              ? 'max-w-[78%] rounded-[14px] bg-red-500/10 px-[15px] py-[11px] text-[13px] leading-[1.5] whitespace-pre-line text-red-500'
              : 'max-w-[78%] rounded-[14px] bg-gray-75 px-[15px] py-[11px] text-[13px] leading-[1.5] whitespace-pre-line text-text-primary'
        }
      >
        {message.notice ? (
          <span role="note" className="text-amber-600 mb-1 block text-[11px]">
            {message.notice}
          </span>
        ) : null}
        {message.streaming && !message.text ? (
          <span role="status" className="text-[12px] text-text-tertiary">
            {message.statusLabel ?? '답변을 쓰는 중…'}
          </span>
        ) : null}
        {message.text}
        {message.setup ? (
          <>
            {message.setup.message !== message.text ? (
              <span className="mt-2 block text-[12px] text-text-secondary">
                {message.setup.message}
              </span>
            ) : null}
            <SetupLink href={message.setup.href} />
          </>
        ) : null}
        {message.footnote ? (
          <span role="note" className="mt-1.5 block text-[11px] text-text-tertiary">
            {message.footnote}
          </span>
        ) : null}
        {message.action ? (
          <Link
            href={message.action.href}
            className="mt-2 block text-[12px] font-semibold text-purple-600 underline"
          >
            {message.action.label} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function ChipRow({
  label,
  chips,
  onPick,
}: {
  label: string;
  chips: readonly string[];
  onPick: (chip: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onPick(chip)}
          className={cn(
            'rounded-pill border border-border-subtle bg-surface-card px-3 py-1.5 text-[12px] font-semibold text-text-secondary hover:text-ink-900',
            PRESS_CLASSES,
          )}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
