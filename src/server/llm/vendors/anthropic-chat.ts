import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { findModel } from '../models';

/**
 * Anthropic 채팅 모델 (PRAMI-002 §4.5.3, PR-B). 요청마다 새 인스턴스 — 키는 이 인스턴스 안에만 있고 상태·로그로 나가지 않는다(I-3).
 *
 * Q-10 결정(② 어댑터 확장): 설치된 `@langchain/anthropic` 1.5.11 로 실제 HTTP 요청을 가로채 확인한 결과
 * `outputConfig.effort` → `output_config.effort`, `betas` → `anthropic-beta` 헤더(beta messages 엔드포인트), `bindTools(…, { strict })` →
 * 도구별 `strict: true` 는 1급 옵션으로 전달되고, `thinking` 은 명시하지 않으면 보내지 않는다. `fallbacks` 만 1급 옵션이 없어
 * `invocationKwargs` 로 요청 본문에 싣는다. SDK 직접 호출(대안 ③)은 필요 없다. 증명: tests/unit/llm/anthropic-request.test.ts (AC-231).
 *
 * 모델별 차이는 models.ts `anthropic` 플래그로만 만든다 (노드에 모델 분기 없음).
 */
export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type ChatModelOptions = {
  maxTokens: number;
  timeoutMs: number;
  /** 테스트 전송 계층 가로채기 전용 (운영은 기본 fetch) */
  fetch?: typeof fetch;
};

export function createAnthropicChatModel(
  secret: string,
  modelId: string,
  options: ChatModelOptions,
): BaseChatModel {
  const traits = findModel('anthropic', modelId)?.anthropic ?? {
    effort: null,
    serverFallback: false,
  };
  return new ChatAnthropic({
    apiKey: secret,
    model: modelId,
    maxTokens: options.maxTokens,
    // LangChain 기본 6회 재시도를 1회로 (비용·지연 상한 §4.8.1)
    maxRetries: 1,
    ...(traits.effort ? { outputConfig: { effort: traits.effort } } : {}),
    // "default" 스칼라 형태는 반드시 -2026-07-01 헤더와 짝 (배열 형태·-2026-06-01 헤더는 쓰지 않는다)
    ...(traits.serverFallback
      ? { betas: [SERVER_FALLBACK_BETA as never], invocationKwargs: { fallbacks: 'default' } }
      : {}),
    clientOptions: {
      timeout: options.timeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  });
}

/** 도구 바인딩 옵션: 강제 tool_choice 없음(Opus/Sonnet 5.5 는 any/tool 400), 모든 도구 strict (§4.5.3) */
export const ANTHROPIC_BIND_OPTIONS = { strict: true } as const;
