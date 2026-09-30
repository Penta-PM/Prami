import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import type { LlmModelOption } from '../models';

/** 벤더 레지스트리 타입 (PRAMI-002 §4.5.1) */
export type LlmAuthType = 'api_key' | 'oauth_pkce';

export type VerifyRequest = { url: string; headers: Record<string, string> };

/** 목록 API 한 페이지에서 읽은 모델 ID 와 다음 페이지 커서 (없으면 null) */
export type ModelListPage = { ids: string[]; next: string | null };

export type LlmVendor = {
  id: string;
  label: string;
  authTypes: readonly LlmAuthType[];
  /** 약한 형식 검사 (최종 판정은 검증 호출) */
  keyFormat: { minLength: number; maxLength: number; pattern: RegExp; hintPrefix: RegExp };
  consoleUrl: string;
  models: readonly LlmModelOption[];
  /** 토큰을 소비하지 않는 목록 호출 (§4.6.3). 키는 헤더에만 — URL 에 넣지 않는다. cursor 는 다음 페이지 */
  verifyRequest: (secret: string, cursor?: string) => VerifyRequest;
  /** 2xx 본문에서 모델 ID 만 읽는다 (그 밖의 본문은 버림). 형식이 다르면 null = 미확인 */
  parseModelList: (body: unknown) => ModelListPage | null;
  /** 벤더 고유 응답 판정(예: Gemini 400 API_KEY_INVALID). 없으면 공통 규칙만 */
  isInvalidKeyResponse?: (status: number, body: unknown) => boolean;
  /**
   * 채팅 모델 팩토리 (§4.5.1, PR-B 는 Anthropic 만 — OpenAI·Gemini 는 PR-C). 없으면 챗봇 LLM 경로에서 쓸 수 없는 벤더다.
   * 요청마다 새 인스턴스. 키는 반환된 인스턴스 안에만 있다(I-3).
   */
  createChatModel?: (
    secret: string,
    model: string,
    options: ChatModelFactoryOptions,
  ) => BaseChatModel;
};

export type ChatModelFactoryOptions = {
  maxTokens: number;
  timeoutMs: number;
  fetch?: typeof fetch;
};

/** API 키 허용 문자 (§4.12: `[A-Za-z0-9_\-.]`) */
export const KEY_CHARSET = /^[A-Za-z0-9_\-.]+$/;

/** `{ [listKey]: [{ [idKey]: string }] }` 형태에서 문자열 ID 만 뽑는다. 배열이 아니면 null */
export function pickIds(body: unknown, listKey: string, idKey: string): string[] | null {
  const list = (body as Record<string, unknown> | null)?.[listKey];
  if (!Array.isArray(list)) return null;
  return list
    .map((entry) => (entry as Record<string, unknown> | null)?.[idKey])
    .filter((id): id is string => typeof id === 'string');
}
