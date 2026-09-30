import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';

import type { ChatModelFactoryOptions } from './types';

/**
 * OpenAI 채팅 모델 (PRAMI-002 §4.5, PR-C) — `@langchain/openai` 1.6.0(내부 `openai` 7.x) 설치 버전으로 실제 요청을 가로채 확인:
 * `POST https://api.openai.com/v1/chat/completions`, `max_completion_tokens`, 도구 `strict:true`(bindTools strict), `tool_choice` 없음.
 * 요청마다 새 인스턴스 — 키는 이 인스턴스 안에만(I-3). 재시도 1회·타임아웃은 §4.8.1 상한.
 * OpenRouter(OpenAI 호환 API)도 이 팩토리를 baseURL 만 바꿔 쓴다 (§4.6.2).
 */
export function createOpenAIChatModel(
  secret: string,
  modelId: string,
  options: ChatModelFactoryOptions,
  baseURL?: string,
): BaseChatModel {
  return new ChatOpenAI({
    apiKey: secret,
    model: modelId,
    maxTokens: options.maxTokens,
    maxRetries: 1,
    timeout: options.timeoutMs,
    configuration: {
      ...(baseURL ? { baseURL } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  });
}
