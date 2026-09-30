import type { LlmModelOption } from '../models';

/** 벤더 레지스트리 타입 (PRAMI-002 §4.5.1) */
export type LlmAuthType = 'api_key' | 'oauth_pkce';

export type VerifyRequest = { url: string; headers: Record<string, string> };

export type LlmVendor = {
  id: string;
  label: string;
  authTypes: readonly LlmAuthType[];
  /** 약한 형식 검사 (최종 판정은 검증 호출) */
  keyFormat: { minLength: number; maxLength: number; pattern: RegExp; hintPrefix: RegExp };
  consoleUrl: string;
  models: readonly LlmModelOption[];
  /** 토큰을 소비하지 않는 목록 호출 (§4.6.3). 키는 헤더에만 — URL 에 넣지 않는다 */
  verifyRequest: (secret: string) => VerifyRequest;
  /** 벤더 고유 응답 판정(예: Gemini 400 API_KEY_INVALID). 없으면 공통 규칙만 */
  isInvalidKeyResponse?: (status: number, body: unknown) => boolean;
};

/** API 키 허용 문자 (§4.12: `[A-Za-z0-9_\-.]`) */
export const KEY_CHARSET = /^[A-Za-z0-9_\-.]+$/;
