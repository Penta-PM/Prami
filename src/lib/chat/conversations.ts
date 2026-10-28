/**
 * 챗봇 대화 저장 규칙 (UX 4건 §4.2, PR-C1) — 순수 모듈. 서버 검증과 대화 화면(PR-C2)이 같은 상수·문구를 쓴다.
 * 길이는 코드 포인트 기준(DB char_length 와 같다 — 이모지가 반으로 잘리지 않게).
 */
export const CHAT_DOMAINS = ['pricing', 'procurement'] as const;
export type ChatDomain = (typeof CHAT_DOMAINS)[number];

export function isChatDomain(value: unknown): value is ChatDomain {
  return typeof value === 'string' && (CHAT_DOMAINS as readonly string[]).includes(value);
}

/** 대화 이름 최대 길이 (DB check 와 같다) */
export const CHAT_TITLE_MAX = 100;
/** 자동 제목 = 첫 질문 앞 N자 */
export const CHAT_AUTO_TITLE_LENGTH = 30;
/** 사용자·domain 당 저장 대화 상한 */
export const CHAT_CONVERSATION_MAX = 200;
/** 대화당 메시지 상한 (질문·답 합계) */
export const CHAT_MESSAGE_MAX = 400;

export const CHAT_CONVERSATION_LIMIT_MESSAGE = `대화는 ${CHAT_CONVERSATION_MAX}개까지 저장됩니다. 지난 대화를 삭제한 뒤 새 대화를 시작하세요`;
export const CHAT_MESSAGE_LIMIT_MESSAGE = `이 대화는 메시지 ${CHAT_MESSAGE_MAX}개 상한에 도달했습니다. 새 대화를 시작하세요`;
export const CHAT_CONVERSATION_NOT_FOUND = '대화를 찾을 수 없습니다';
export const CHAT_TITLE_EMPTY_MESSAGE = '대화 이름을 입력하세요';
export const CHAT_TITLE_TOO_LONG_MESSAGE = `대화 이름은 ${CHAT_TITLE_MAX}자까지 입력할 수 있습니다`;

const codePoints = (text: string) => Array.from(text);

/** 공백 정리(연속 공백·줄바꿈 → 공백 1개, 앞뒤 제거) */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 첫 질문 → 자동 제목(앞 30자). 비면 null(제목 없음 유지) */
export function autoTitle(question: string): string | null {
  const text = codePoints(squash(question)).slice(0, CHAT_AUTO_TITLE_LENGTH).join('').trim();
  return text ? text : null;
}

export type TitleCheck = { ok: true; title: string } | { ok: false; message: string };

/** 이름 바꾸기 검증: 앞뒤 공백 제거 후 1~100자 */
export function normalizeTitle(raw: unknown): TitleCheck {
  if (typeof raw !== 'string') return { ok: false, message: CHAT_TITLE_EMPTY_MESSAGE };
  const title = squash(raw);
  if (!title) return { ok: false, message: CHAT_TITLE_EMPTY_MESSAGE };
  if (codePoints(title).length > CHAT_TITLE_MAX)
    return { ok: false, message: CHAT_TITLE_TOO_LONG_MESSAGE };
  return { ok: true, title };
}

/** 앞에서 max 코드 포인트까지 (history 항목 절단) */
export function truncateCodePoints(text: string, max: number): string {
  const points = codePoints(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}
