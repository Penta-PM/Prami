import { modelsFor } from '../models';
import { KEY_CHARSET, pickIds, type LlmVendor } from './types';

/** OpenAI 검증 요청 (§4.6.3): GET /v1/models, Authorization: Bearer. 응답 `data[].id` (페이지 없음) */
export const openai: LlmVendor = {
  id: 'openai',
  label: 'OpenAI',
  authTypes: ['api_key'],
  keyFormat: { minLength: 16, maxLength: 256, pattern: KEY_CHARSET, hintPrefix: /^sk-(proj-)?/ },
  consoleUrl: 'https://platform.openai.com/api-keys',
  models: modelsFor('openai'),
  verifyRequest: (secret) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { authorization: `Bearer ${secret}` },
  }),
  parseModelList: (body) => {
    const ids = pickIds(body, 'data', 'id');
    return ids ? { ids, next: null } : null;
  },
};
