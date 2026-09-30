import { modelsFor } from '../models';
import { KEY_CHARSET, type LlmVendor } from './types';

/** OpenAI 검증 요청 (§4.6.3): GET /v1/models, Authorization: Bearer */
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
};
