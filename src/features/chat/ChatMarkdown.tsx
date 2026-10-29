'use client';

import Link from 'next/link';
import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { FOCUS_RING_CLASSES } from '@/components/ui/button';
import { closeOpenFence, internalHref } from '@/lib/chat/markdown';
import { cn } from '@/lib/cn';

/**
 * 챗봇 assistant 답변 마크다운 (docs/specs/chat-markdown.md) — 스트리밍 중·완료 후·저장 대화 재열람 모두 이 컴포넌트.
 * - 원문 HTML 은 렌더하지 않는다(`skipHtml`, rehype-raw 없음). 요소는 허용 목록만, 나머지는 글자만 남긴다(unwrapDisallowed).
 * - 링크는 내부 경로(`/…`)만 `<a>`. 외부 http(s)·javascript:·data:·mailto: … 는 글자. 이미지는 alt 글자만(원격 로드 0).
 * - 말풍선 안 제목 상한: h1·h2 → h3 요소 16px/600, h3·h4 → h4 요소 14px/600 (페이지 제목 계층을 넘지 않게).
 * - 색은 Penta 의미 토큰만. 표만 가로 스크롤(키보드로 포커스 가능한 region), 말풍선 폭은 그대로.
 */
const ALLOWED_ELEMENTS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'a',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
];

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** 내부 경로만 남기고 나머지 URL 은 비운다 → 아래 `a` 가 글자로 렌더 */
const urlTransform = (url: string) => internalHref(url) ?? '';

const HEADING_LG = 'm-0 text-[16px] leading-[1.4] font-semibold';
const HEADING_SM = 'm-0 text-[14px] leading-[1.55] font-semibold';

const COMPONENTS: Components = {
  p: ({ children }) => <p className="m-0">{children}</p>,
  h1: ({ children }) => <h3 className={HEADING_LG}>{children}</h3>,
  h2: ({ children }) => <h3 className={HEADING_LG}>{children}</h3>,
  h3: ({ children }) => <h4 className={HEADING_SM}>{children}</h4>,
  h4: ({ children }) => <h4 className={HEADING_SM}>{children}</h4>,
  ul: ({ children }) => <ul className="m-0 list-disc pl-[1.25em] [&>li+li]:mt-0.5">{children}</ul>,
  ol: ({ children }) => (
    <ol className="m-0 list-decimal pl-[1.25em] [&>li+li]:mt-0.5">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="m-0 border-0 border-l-2 border-solid border-border-subtle pl-3 text-text-secondary">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-0 border-0 border-t border-solid border-border-subtle" />,
  code: ({ className, children }) => (
    <code
      className={cn(
        'rounded bg-surface-card px-1 py-px font-mono text-[13px] [pre>&]:bg-transparent [pre>&]:p-0',
        className,
      )}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="m-0 overflow-x-auto rounded-lg bg-surface-card px-3 py-2.5 font-mono text-[13px] leading-[1.5]">
      {children}
    </pre>
  ),
  a: ({ href, children }) =>
    href ? (
      <Link
        href={href}
        className={cn('text-link underline hover:text-link-hover', FOCUS_RING_CLASSES)}
      >
        {children}
      </Link>
    ) : (
      <span>{children}</span>
    ),
  // 이미지는 그리지 않는다 — alt 글자만 (원격 로드 0, CSP img-src 와 이중 방어)
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  table: ({ children }) => (
    <div
      role="region"
      aria-label="표"
      tabIndex={0}
      className={cn('max-w-full overflow-x-auto rounded-lg', FOCUS_RING_CLASSES)}
    >
      <table className="w-max min-w-full border-collapse text-[14px] leading-[1.45]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-card">{children}</thead>,
  th: ({ style, children }) => (
    <th
      scope="col"
      style={style}
      className="border-0 border-b border-solid border-border-default px-2.5 py-1.5 text-left font-semibold whitespace-nowrap"
    >
      {children}
    </th>
  ),
  td: ({ style, children }) => (
    <td
      style={style}
      className="border-0 border-b border-solid border-border-subtle px-2.5 py-1.5 align-top"
    >
      {children}
    </td>
  ),
};

/** 스트리밍 중 렌더 throttle — 토큰마다 마크다운을 다시 파싱하지 않게 50ms 에 한 번 (완료 후는 즉시 원문) */
const STREAM_RENDER_MS = 50;

function useStreamThrottle(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(text);
  const lastAt = useRef(0);
  useEffect(() => {
    if (!streaming) return;
    const wait = Math.max(0, lastAt.current + STREAM_RENDER_MS - Date.now());
    const timer = setTimeout(() => {
      lastAt.current = Date.now();
      setShown(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, streaming]);
  return streaming ? shown : text;
}

const MarkdownBody = memo(function MarkdownBody({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      skipHtml
      urlTransform={urlTransform}
      components={COMPONENTS}
    >
      {source}
    </ReactMarkdown>
  );
});

export function ChatMarkdown({
  text,
  streaming = false,
  onRendered,
}: {
  text: string;
  streaming?: boolean;
  /** 스트리밍 중 throttle 된 렌더가 반영될 때마다 (대화창이 바닥으로 스크롤) */
  onRendered?: () => void;
}) {
  const shown = useStreamThrottle(text, streaming);
  const source = streaming ? closeOpenFence(shown) : shown;
  useEffect(() => {
    onRendered?.();
  }, [source, onRendered]);
  return (
    <div data-markdown className="flex min-w-0 flex-col gap-1.5 break-words">
      <MarkdownBody source={source} />
    </div>
  );
}
