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

/** 서버로 보내는 최근 대화 (텍스트만, 서버 미저장) */
export type ChatHistoryItem = { role: 'user' | 'assistant'; text: string };

export type ChatMessage = {
  id: string;
  from: 'user' | 'bot';
  text: string;
  intent?: ChatIntentView;
  action?: ChatActionView | null;
  tone?: 'error';
  notice?: string;
  /** 설정 안내 (§4.9) — 링크 버튼으로 /settings#llm */
  setup?: ChatSetupView;
  /** 답 뒤에 붙는 한 줄 (예: "LLM 미연결 — 기본 응답") */
  footnote?: string;
  /** 히스토리 대상인 실제 문답인지 (인사·안내·오류 말풍선은 제외) */
  exchange?: boolean;
};
