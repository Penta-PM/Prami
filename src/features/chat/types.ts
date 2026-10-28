import type { ChatDomain } from '@/lib/chat/conversations';

/** 클라이언트가 주고받는 챗봇 데이터 (서버 ChatReply 와 같은 형태, 원가 키 없음) */
export type ChatIntentView = 'cost' | 'compare' | 'quote' | 'price' | 'help';

export type ChatActionView = { type: 'calculator'; href: string; label: string };

export type ChatReplyView = {
  intent: ChatIntentView;
  reply: string;
  candidates: { itemCode: string; itemName: string; productFamily: string }[];
  showProductChips: boolean;
  action: ChatActionView | null;
  notice?: string;
  /** PRAMI-002 §4.3.11 추가 필드 — 규칙 전용 응답(PR-10)에는 없을 수 있다 */
  mode?: 'llm' | 'rule' | 'setup' | 'refusal';
  llm?: ChatLlmView;
  setup?: ChatSetupView;
};

export type ChatLlmView = { status: string; vendor: string | null; model: string | null };

export type ChatSetupView = { status: string; message: string; href: string };

/** GET /api/chat/status (키·힌트 없음) */
export type ChatStatusView = { llm: ChatLlmView; ruleFallback: boolean; setup?: ChatSetupView };

/** 저장 대화 목록 행 — GET /api/chat/conversations (UX PR-C1 ConversationView 와 같은 형태) */
export type ConversationSummary = {
  id: string;
  domain: ChatDomain;
  /** null = 아직 제목 없음(첫 질문 전) — 화면은 "새 대화" */
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 저장된 메시지 — GET /api/chat/conversations/:id 의 messages */
export type StoredMessageView = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  action: ChatActionView | null;
  createdAt: string;
};

export type ConversationDetailView = ConversationSummary & { messages: StoredMessageView[] };

/** 화면 말풍선 */
export type ChatMessage = {
  id: string;
  from: 'user' | 'bot';
  text: string;
  /** 작성 시각(ISO) — 저장된 가격은 그 시점 값이라 말풍선마다 보인다 */
  createdAt: string;
  intent?: ChatIntentView;
  action?: ChatActionView | null;
  tone?: 'error';
  notice?: string;
  /** 설정 안내 (§4.9) — 링크 버튼으로 /settings#llm */
  setup?: ChatSetupView;
  /** 답 뒤에 붙는 한 줄 (예: "LLM 미연결 — 기본 응답") */
  footnote?: string;
  /** SSE 로 받는 중 (토큰 점진 표시) */
  streaming?: boolean;
  /** 도구 진행 표시 (SSE status) */
  statusLabel?: string;
};
