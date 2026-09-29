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
};

export type ChatMessage = {
  id: string;
  from: 'user' | 'bot';
  text: string;
  intent?: ChatIntentView;
  action?: ChatActionView | null;
  tone?: 'error';
  notice?: string;
};
