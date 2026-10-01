import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { ChatOpenAI } from '@langchain/openai';

import { findModel } from '../models';
import type { ChatModelFactoryOptions } from './types';

/**
 * OpenAI 채팅 모델 (PRAMI-002 §4.5, PRAMI-003 핫픽스) — **Responses API** (`POST /v1/responses`).
 *
 * 원인(PRAMI-003, 실호출 1회로 확정): Chat Completions + 함수 도구 요청이 GPT-6 계열에서 400 `invalid_request_error`
 * (`param: reasoning_effort`)로 거부됐다. OpenAI 공식 문서(2026-10-01 확인
 * https://developers.openai.com/api/docs/guides/latest-model · …/models/gpt-6-luna):
 * "GPT-6 Astra and GPT-6.1 Sol support Chat Completions, but tool calling requires Responses." /
 * "GPT-6 Sol and GPT-6 Luna support function calling in Chat Completions only with `reasoning_effort: "none"`."
 * 기본 모델 gpt-6.1-sol 은 `none` 을 지원하지 않으므로 Chat Completions 로는 도구 호출이 불가능 → Responses 로 전환한다.
 *
 * - `reasoning.effort: 'low'` — 모든 GPT-6 모델이 지원(Astra·6.1 Sol 은 `none` 미지원), Anthropic 어댑터의 effort low 와 같은 수준
 * - `store: false`(zdrEnabled) — 벤더 측 응답 저장 없음(앱도 대화를 저장하지 않는다, AC-230). 도구 루프의 추론 연속성은
 *   `include: ['reasoning.encrypted_content']` 로 받은 암호화 추론 항목을 다음 요청에 돌려준다(상태 없는 방식)
 * - `max_output_tokens` = 보이는 답 상한 + 모델 상수 `reasoningReserveTokens`(추론 토큰이 상한에 포함, PRAMI-003 L-3 — 기본 9,216),
 *   도구 `strict:true`(bindTools strict), `tool_choice` 없음, temperature·top_p 미전송
 * 요청마다 새 인스턴스 — 키는 이 인스턴스 안에만(I-3). 재시도 1회·타임아웃은 §4.8.1 상한.
 */
export function createOpenAIChatModel(
  secret: string,
  modelId: string,
  options: ChatModelFactoryOptions,
): BaseChatModel {
  return createResponsesChatModel(secret, modelId, options, OPENAI_PROFILE);
}

/**
 * Responses API 벤더 프로필 (PRAMI-003 §4.7.2) — OpenAI 와 OpenAI 호환 Responses 벤더(xAI)의 차이만 담는다.
 * - vendor: 모델 상수(`reasoningReserveTokens`) 조회용 레지스트리 id
 * - baseURL: 없으면 기본 OpenAI. 코드 상수만(사용자·env 로 바꿀 수 없다, T-12)
 * - modelKwargs: 요청 본문에 그대로 더해지는 벤더 고유 필드(include·reasoning 등)
 */
export type ResponsesProfile = {
  vendor: string;
  baseURL?: string;
  reasoningEffort: 'low';
  modelKwargs: Record<string, unknown>;
};

export const OPENAI_PROFILE: ResponsesProfile = {
  vendor: 'openai',
  reasoningEffort: 'low',
  modelKwargs: { include: ['reasoning.encrypted_content'] },
};

/** Responses API 채팅 모델 공통 생성 — 재시도 1회·타임아웃·`store:false`(zdrEnabled)·fetch 주입은 모든 프로필이 같다 */
export function createResponsesChatModel(
  secret: string,
  modelId: string,
  options: ChatModelFactoryOptions,
  profile: ResponsesProfile,
): BaseChatModel {
  const reserve = findModel(profile.vendor, modelId)?.reasoningReserveTokens ?? 0;
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  return new ChatOpenAI({
    apiKey: secret,
    model: modelId,
    maxTokens: options.maxTokens + reserve,
    maxRetries: 1,
    timeout: options.timeoutMs,
    useResponsesApi: true,
    zdrEnabled: true,
    reasoning: { effort: profile.reasoningEffort },
    modelKwargs: profile.modelKwargs,
    configuration: profile.baseURL ? { baseURL: profile.baseURL, ...fetchOption } : fetchOption,
  });
}

/**
 * 스트리밍 종료 사유 보존 (PRAMI-003 AC-372 선택, PR #20 I-2) — Gemini 어댑터와 같은 이유(`google-chat.ts`):
 * Chat Completions 청크의 `finish_reason` 은 `generationInfo` 에만 있고 SSE 집계 메시지의 `response_metadata` 로 합쳐지지 않는다.
 * 마지막 값만 담은 빈 청크를 끝에 내보내 `classifyResponse` 가 `finish_reason:'length'` 를 보게 한다. JSON 경로는 원래 합쳐진다.
 */
class ChatCompletionsModel extends ChatOpenAI {
  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    let finishReason: unknown;
    for await (const chunk of super._streamResponseChunks(messages, options, runManager)) {
      finishReason = chunk.generationInfo?.finish_reason ?? finishReason;
      yield chunk;
    }
    if (finishReason !== 'length') return;
    yield new ChatGenerationChunk({
      text: '',
      message: new AIMessageChunk({
        content: '',
        response_metadata: { finish_reason: finishReason },
      }),
    });
  }

  /** 설치 버전의 `withConfig`(bindTools 경유)는 `new ChatOpenAI(...)` 로 하위 클래스를 잃는다 — 같은 클래스로 복제 */
  override withConfig(
    config: Parameters<ChatOpenAI['withConfig']>[0],
  ): ReturnType<ChatOpenAI['withConfig']> {
    const self = this as unknown as {
      fields: ConstructorParameters<typeof ChatOpenAI>[0];
      defaultOptions: object;
    };
    const copy = new ChatCompletionsModel(self.fields);
    (copy as unknown as { defaultOptions: object }).defaultOptions = {
      ...self.defaultOptions,
      ...config,
    };
    return copy as unknown as ReturnType<ChatOpenAI['withConfig']>;
  }
}

/**
 * OpenAI 호환 Chat Completions (OpenRouter §4.6.2 — baseURL 만 다름). OpenRouter 는 기본 off 플래그 뒤에 있고
 * 실호출 확인을 하지 않았다(PRAMI-003 미실행 목록). 직접 OpenAI 경로와 달리 Chat Completions 를 유지한다.
 */
export function createOpenAICompatibleChatModel(
  secret: string,
  modelId: string,
  options: ChatModelFactoryOptions,
  baseURL: string,
): BaseChatModel {
  return new ChatCompletionsModel({
    apiKey: secret,
    model: modelId,
    maxTokens: options.maxTokens,
    maxRetries: 1,
    timeout: options.timeoutMs,
    configuration: { baseURL, ...(options.fetch ? { fetch: options.fetch } : {}) },
  });
}
