import { modelsFor } from '../models';
import { createOpenAIChatModel } from './openai-chat';
import { KEY_CHARSET, type LlmVendor } from './types';

/**
 * OpenRouter (PRAMI-002 §4.6.2 "OAuth" 해석 (b), PR-C) — **OAuth PKCE 전용**(키 직접 입력 없음), 플래그 `LLM_OAUTH_OPENROUTER` 기본 off.
 * 공식 문서(2026-09-30): https://openrouter.ai/docs/guides/overview/auth/oauth — 교환 결과는 사용자 소유·사용자 과금 API 키.
 * 검증: `GET https://openrouter.ai/api/v1/key` (Authorization: Bearer) — https://openrouter.ai/docs/api/reference/limits.
 * 채팅: OpenAI 호환 API(`https://openrouter.ai/api/v1`) → ChatOpenAI baseURL. 모델 목록 응답이 없어 사용 가능 모델은 미확인(NULL = 상수 전체).
 */
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export const openrouter: LlmVendor = {
  id: 'openrouter',
  label: 'OpenRouter',
  authTypes: ['oauth_pkce'],
  host: 'openrouter.ai',
  enabled: (flags) => flags.oauthOpenRouter,
  keyFormat: { minLength: 16, maxLength: 256, pattern: KEY_CHARSET, hintPrefix: /^sk-or-/ },
  consoleUrl: 'https://openrouter.ai/settings/keys',
  models: modelsFor('openrouter'),
  verifyRequest: (secret) => ({
    url: `${OPENROUTER_API_BASE}/key`,
    headers: { authorization: `Bearer ${secret}` },
  }),
  // 키 정보 응답에는 모델 목록이 없다 → 사용 가능 모델 미확인
  parseModelList: () => null,
  createChatModel: (secret, model, options) =>
    createOpenAIChatModel(secret, model, options, OPENROUTER_API_BASE),
};
