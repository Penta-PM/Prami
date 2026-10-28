import type { ChatDomain } from '@/lib/chat/conversations';

/**
 * 챗봇 화면 문구 (UX PR-C2) — domain 별 제목·안내·예시 질문. 서버 페이지와 클라이언트 화면이 같이 쓴다(순수 모듈).
 * 링크는 같은 탭 이동이고 대화는 DB 에 있어 돌아오면 `?c=` 로 복원된다.
 */
export type ChatPageCopy = {
  /** 화면·메뉴 이름 */
  title: string;
  /** 화면 경로 */
  path: string;
  /** 제목 아래 한 줄 */
  description: string;
  /** 대화가 비어 있을 때 안내 */
  greeting: string;
  examples: readonly string[];
  placeholder: string;
};

export const PRICING_EXAMPLE_QUESTIONS = [
  'Wapples-500 가격 알려줘',
  '작년보다 올랐어?',
  '견적 뽑아줘',
] as const;

export const PROCUREMENT_EXAMPLE_QUESTIONS = [
  '올해 조달 실적 요약해줘',
  '이번 주 마감 입찰 공고 알려줘',
  'WAPPLES 등록 품목 찾아줘',
] as const;

/** 견적 질문 뒤 제품 퀵칩 (가격 챗봇) */
export const PRODUCT_CHIPS = ['WAPPLES', 'D.AMO', 'iSIGN', 'Cloudbric'] as const;

export const CHAT_PAGE_COPY: Readonly<Record<ChatDomain, ChatPageCopy>> = {
  pricing: {
    title: '가격 정책 챗봇',
    path: '/pricing/chat',
    description: '원가 데이터는 표시되지 않습니다. 답변의 가격은 메시지 작성 시각 기준입니다.',
    greeting:
      '안녕하세요! WAPPLES, D.AMO, iSIGN, Cloudbric 가격정책과 견적에 대해 무엇이든 물어보세요.',
    examples: PRICING_EXAMPLE_QUESTIONS,
    placeholder: '예: SA-500 가격이 얼마야?',
  },
  procurement: {
    title: '조달 챗봇',
    path: '/procurement/chat',
    description: '조달 화면에서 볼 수 있는 범위(실적·등록 품목·입찰 공고·납품요구)만 답합니다.',
    greeting: '조달 실적, 등록 품목, 입찰 공고, 납품요구에 대해 물어보세요.',
    examples: PROCUREMENT_EXAMPLE_QUESTIONS,
    placeholder: '예: 이번 주 마감 입찰 공고 알려줘',
  },
};

/** 제목 없는 대화(첫 질문 전)의 표시 이름 */
export const UNTITLED_CONVERSATION = '새 대화';
export const MISSING_SHORT = 'LLM 미연결 — 기본 응답';
export const LIST_LOAD_ERROR = '대화 목록을 불러오지 못했습니다.';
export const CONVERSATION_LOAD_ERROR = '대화를 불러오지 못했습니다.';
export const DELETE_WARNING = '삭제한 대화는 되돌릴 수 없습니다. 메시지도 모두 함께 지워집니다.';
