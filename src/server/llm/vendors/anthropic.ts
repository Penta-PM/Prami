import { modelsFor } from '../models';
import { createAnthropicChatModel } from './anthropic-chat';
import { KEY_CHARSET, pickIds, type LlmVendor } from './types';

/**
 * Anthropic 검증 요청 (PRAMI-002 §4.6.3): GET /v1/models?limit=1000, 헤더 x-api-key + anthropic-version.
 * 응답 `data[].id` 로 사용 가능 모델을 계산한다. `has_more` 면 `after_id=last_id` 로 다음 페이지.
 */
export const anthropic: LlmVendor = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  authTypes: ['api_key'],
  keyFormat: { minLength: 16, maxLength: 256, pattern: KEY_CHARSET, hintPrefix: /^sk-ant-/ },
  host: 'api.anthropic.com',
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  models: modelsFor('anthropic'),
  verifyRequest: (secret, cursor) => ({
    url: `https://api.anthropic.com/v1/models?limit=1000${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`,
    headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' },
  }),
  createChatModel: createAnthropicChatModel,
  parseModelList: (body) => {
    const ids = pickIds(body, 'data', 'id');
    if (!ids) return null;
    const page = body as { has_more?: unknown; last_id?: unknown };
    const next = page.has_more === true && typeof page.last_id === 'string' ? page.last_id : null;
    return { ids, next };
  },
};
