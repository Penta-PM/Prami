import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

import type { ChatModelFactoryOptions } from './types';

/**
 * Google Gemini 채팅 모델 (PRAMI-002 §4.5, PR-C, §11 Q-09) — `@langchain/google-genai` 2.3.2(내부 `@google/generative-ai` 0.24.1)
 * 설치 버전으로 실제 요청을 가로채 확인: `POST …/v1beta/models/{model}:streamGenerateContent?alt=sse` (아래 streaming 이유), 키는 헤더 `x-goog-api-key`,
 * `generationConfig.maxOutputTokens`, 강제 `toolConfig` 없음.
 * 이 SDK 는 fetch 주입 옵션이 없어 전역 fetch 를 쓴다(테스트는 전역 fetch 스텁).
 * **streaming: true 인 이유**: 설치 버전 2.3.2 의 비스트리밍 `_generate` 는 `completionWithRetry(request)` 를 옵션 없이 불러
 * 호출 signal(타임아웃·클라이언트 중단)을 SDK 요청에 넘기지 않는다. 스트리밍 경로는 `generateContentStream(request, { signal })`
 * 로 넘기므로, 결과는 같고(청크를 모아 한 메시지) agent 노드의 AbortSignal.timeout 이 실제로 요청을 끊는다(계약 테스트로 확인).
 */
export function createGoogleChatModel(
  secret: string,
  modelId: string,
  options: ChatModelFactoryOptions,
): BaseChatModel {
  return new ChatGoogleGenerativeAI({
    apiKey: secret,
    model: modelId,
    maxOutputTokens: options.maxTokens,
    maxRetries: 1,
    streaming: true,
  });
}
