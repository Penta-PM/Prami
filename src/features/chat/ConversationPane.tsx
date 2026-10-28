'use client';

import { m, type Variants } from 'motion/react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import { Icon } from '@/components/icons/Icon';
import { Presence } from '@/components/motion/Presence';
import { Button, FOCUS_RING_CLASSES, Input } from '@/components/ui';
import { PRESS_CLASSES } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/date-format';
import { transition, VARIANT_KEYS } from '@/lib/motion/tokens';

import { CONVERSATION_LOAD_ERROR, PRODUCT_CHIPS, type ChatPageCopy } from './copy';
import { BillingNotice, SetupBanner, SetupLink } from './SetupBanner';
import type { ChatMessage, ChatStatusView } from './types';
import type { useConversationThread } from './useConversationThread';

/**
 * 대화창 (UX PR-C2): 말풍선(평문 — 마크다운·링크화 없음, §4.3.10)·작성 시각, 예시 질문 칩(빈 대화), 제품 퀵칩·후보 칩,
 * "계산기에서 열기" 같은 서버 액션 링크(같은 탭), 스트리밍 중 "중지", 실패·중지 뒤 "다시 시도", LLM 안내 배너·과금 고지.
 * 접근성: 말풍선 영역은 role=log(스트리밍 동안 aria-busy), 진행 상태는 별도 live region 으로 한 번씩만 알린다.
 * 밀도: 입력창·보내기·중지 = 폼(md), 칩 = 기존 칩 크기.
 */
type Thread = ReturnType<typeof useConversationThread>;

export type ConversationPaneProps = {
  copy: ChatPageCopy;
  thread: Thread;
  /** 머리 제목 (목록의 이름 바꾸기가 바로 반영되도록 목록 값 우선) */
  title: string;
  status: ChatStatusView | null;
  /** 좁은 화면에서 목록으로 돌아가기 (없으면 버튼 없음) */
  onBack?: () => void;
  composerRef: RefObject<HTMLInputElement | null>;
};

/** 새 말풍선 진입 (Motion 도입 스펙 §3.3 챗 메시지): 아래 8px 에서 fade, `transition.base`. `layout` 은 쓰지 않는다(§3.4-3) */
const bubbleEnter: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transition.base },
};

export function ConversationPane({
  copy,
  thread,
  title,
  status,
  onBack,
  composerRef,
}: ConversationPaneProps) {
  const titleId = useId();
  const [input, setInput] = useState('');
  const [billingDismissed, setBillingDismissed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const { messages, isSending, load, chips } = thread;

  useEffect(() => {
    // 새 메시지가 오면 바닥으로 (jsdom 에는 scrollTo 가 없다)
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [messages]);

  const send = (raw: string) => {
    if (!raw.trim() || isSending) return;
    setInput('');
    void thread.send(raw);
  };

  const last = messages.at(-1);
  const liveText = isSending
    ? '답변을 쓰는 중…'
    : last?.from === 'bot' && last.tone === 'error'
      ? `답변을 받지 못했습니다. ${last.text}`
      : last?.from === 'bot'
        ? '답변을 받았습니다.'
        : '';

  return (
    <section aria-labelledby={titleId} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 items-center gap-2 border-b border-border-subtle px-5 py-2 max-md:px-3">
        {onBack ? (
          <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
            <Icon name="chevron-right" className="rotate-180" />
            대화 목록
          </Button>
        ) : null}
        <h2 id={titleId} className="m-0 min-w-0 truncate text-[16px] font-semibold">
          {title}
        </h2>
      </header>
      {status?.setup ? <SetupBanner setup={status.setup} /> : null}
      {status?.llm.status === 'ready' && !billingDismissed ? (
        <BillingNotice onClose={() => setBillingDismissed(true)} />
      ) : null}
      <div
        ref={logRef}
        role="log"
        aria-label="대화"
        aria-busy={isSending || load === 'loading' ? true : undefined}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 max-md:px-3"
      >
        {load === 'loading' ? (
          <p role="status" className="m-0 text-[13px] text-text-tertiary">
            대화를 불러오는 중…
          </p>
        ) : null}
        {load === 'missing' ? (
          <p role="alert" className="m-0 text-[14px] text-text-secondary">
            {thread.loadMessage}. 목록에서 다른 대화를 고르거나 새 대화를 시작하세요.
          </p>
        ) : null}
        {load === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0 text-[14px] text-text-secondary">{CONVERSATION_LOAD_ERROR}</p>
            <Button onClick={thread.reload}>다시 시도</Button>
          </div>
        ) : null}
        {load === 'ready' && messages.length === 0 ? (
          <>
            <p className="m-0 text-[14px] leading-[1.6] text-text-secondary">{copy.greeting}</p>
            <ChipRow label="예시 질문" chips={copy.examples} onPick={send} />
          </>
        ) : null}
        <Presence key={`${thread.activeId ?? 'new'}:${load}`}>
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </Presence>
        {thread.canRetry ? (
          <div className="flex items-center gap-2">
            {last?.from === 'user' ? (
              <span className="text-[13px] text-text-tertiary">이 질문에는 답변이 없습니다.</span>
            ) : null}
            <Button size="sm" onClick={thread.retry}>
              다시 시도
            </Button>
          </div>
        ) : null}
        {chips.showProductChips ? (
          <ChipRow
            label="제품 선택"
            chips={PRODUCT_CHIPS}
            onPick={(chip) => send(`${chip} 견적`)}
          />
        ) : null}
        {chips.candidates.length > 0 ? (
          <ChipRow
            label="후보 품목"
            chips={chips.candidates.map(
              (candidate) => `${candidate.itemName.trim()} (${candidate.itemCode})`,
            )}
            onPick={(chip) => send(chip.replace(/^.*\(([^)]+)\)$/, '$1'))}
          />
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {liveText}
      </p>
      <form
        className="flex gap-2 border-t border-border-subtle px-5 py-3 max-md:px-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <Input
          ref={composerRef}
          size="md"
          aria-label="질문 입력"
          value={input}
          maxLength={200}
          disabled={load === 'loading' || load === 'missing'}
          onChange={(event) => setInput(event.target.value)}
          placeholder={copy.placeholder}
        />
        {isSending ? (
          <Button size="md" variant="secondary" onClick={thread.stop}>
            중지
          </Button>
        ) : (
          <Button
            type="submit"
            size="md"
            variant="primary"
            disabled={input.trim() === '' || load === 'loading' || load === 'missing'}
          >
            보내기
          </Button>
        )}
      </form>
    </section>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.from === 'user';
  // key=message.id 는 스트리밍 내내 같다 — 글자가 늘어도 재마운트·재진입하지 않는다
  return (
    <m.div
      variants={bubbleEnter}
      initial={VARIANT_KEYS.initial}
      animate={VARIANT_KEYS.animate}
      className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}
    >
      <div
        data-from={message.from}
        className={cn(
          'max-w-[78%] rounded-[14px] px-[15px] py-[11px] text-[14px] leading-[1.55] whitespace-pre-line max-md:max-w-[90%]',
          isUser
            ? 'bg-primary-600 text-white'
            : message.tone === 'error'
              ? 'bg-error-50 text-text-danger'
              : 'bg-gray-75 text-text-primary',
        )}
      >
        {message.notice ? (
          <span role="note" className="mb-1 block text-[12px] text-warning-700">
            {message.notice}
          </span>
        ) : null}
        {message.streaming && !message.text ? (
          <span className="text-[13px] text-text-tertiary">
            {message.statusLabel ?? '답변을 쓰는 중…'}
          </span>
        ) : null}
        {message.text}
        {message.setup ? (
          <>
            {message.setup.message !== message.text ? (
              <span className="mt-2 block text-[13px] text-text-secondary">
                {message.setup.message}
              </span>
            ) : null}
            <SetupLink href={message.setup.href} />
          </>
        ) : null}
        {message.footnote ? (
          <span role="note" className="mt-1.5 block text-[12px] text-text-tertiary">
            {message.footnote}
          </span>
        ) : null}
        {message.action ? (
          <Link
            href={message.action.href}
            className="mt-2 block text-[13px] font-semibold text-link underline hover:text-link-hover"
          >
            {message.action.label} →
          </Link>
        ) : null}
      </div>
      <time
        dateTime={message.createdAt}
        className="px-1 text-[11px] text-text-tertiary tabular-nums"
      >
        {formatDateTime(message.createdAt)}
      </time>
    </m.div>
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
            'rounded-pill border border-border-subtle bg-surface-card px-3 py-1.5 text-[13px] font-semibold text-text-secondary hover:border-primary-600 hover:text-primary-700',
            PRESS_CLASSES,
            FOCUS_RING_CLASSES,
          )}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
