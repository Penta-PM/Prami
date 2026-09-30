import { modelsFor } from '../models';
import { KEY_CHARSET, type LlmVendor } from './types';

/** Google Gemini 검증 요청 (§4.6.3): GET /v1beta/models?pageSize=1, 헤더 x-goog-api-key */
export const google: LlmVendor = {
  id: 'google',
  label: 'Google Gemini',
  authTypes: ['api_key'],
  keyFormat: { minLength: 16, maxLength: 256, pattern: KEY_CHARSET, hintPrefix: /^AIza/ },
  consoleUrl: 'https://aistudio.google.com/app/apikey',
  models: modelsFor('google'),
  // URL 쿼리 `?key=` 금지 — 프록시·로그에 남는다. 헤더 x-goog-api-key 만 쓴다
  verifyRequest: (secret) => ({
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: { 'x-goog-api-key': secret },
  }),
  // Gemini 는 잘못된 키에 401 이 아니라 400 INVALID_ARGUMENT + details[].reason='API_KEY_INVALID' 를 준다
  isInvalidKeyResponse: (status, body) => status === 400 && hasReason(body, 'API_KEY_INVALID'),
};

function hasReason(body: unknown, reason: string): boolean {
  const details = (body as { error?: { details?: { reason?: string }[] } } | null)?.error?.details;
  return Array.isArray(details) && details.some((detail) => detail?.reason === reason);
}
