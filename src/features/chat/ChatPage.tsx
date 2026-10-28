import type { ChatDomain } from '@/lib/chat/conversations';

import { ChatWorkspace } from './ChatWorkspace';
import { CHAT_PAGE_COPY } from './copy';

/**
 * 챗봇 화면 틀 (UX PR-C2, 서버 컴포넌트) — 제목·안내 한 줄 + 클라이언트 본문(ChatWorkspace).
 * 권한 확인은 각 page.tsx 가 먼저 한다(가격 = chat.use, 조달 = chat.use + procurement.read). 높이는 앱 셸 본문(헤더 72 + 본문 여백)에 맞춘다.
 */
export function ChatPage({ domain }: { domain: ChatDomain }) {
  const copy = CHAT_PAGE_COPY[domain];
  return (
    <section
      aria-labelledby="page-title"
      className="flex h-[calc(100dvh-136px)] min-h-[520px] min-w-0 flex-col gap-3 max-md:h-[calc(100dvh-104px)] max-md:min-h-[480px]"
    >
      <div className="flex flex-col gap-1">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          {copy.title}
        </h1>
        <p className="m-0 text-[13px] text-text-tertiary">{copy.description}</p>
      </div>
      <ChatWorkspace domain={domain} />
    </section>
  );
}
