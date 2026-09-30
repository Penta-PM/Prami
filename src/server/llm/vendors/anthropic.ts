import { modelsFor } from '../models';
import { KEY_CHARSET, type LlmVendor } from './types';

/** Anthropic 검증 요청 (PRAMI-002 §4.6.3): GET /v1/models?limit=1, 헤더 x-api-key + anthropic-version */
export const anthropic: LlmVendor = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  authTypes: ['api_key'],
  keyFormat: { minLength: 16, maxLength: 256, pattern: KEY_CHARSET, hintPrefix: /^sk-ant-/ },
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  models: modelsFor('anthropic'),
  verifyRequest: (secret) => ({
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' },
  }),
};
