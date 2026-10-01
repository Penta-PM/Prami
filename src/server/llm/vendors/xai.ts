import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { modelsFor } from '../models';
import { createResponsesChatModel, type ResponsesProfile } from './openai-chat';
import { KEY_CHARSET, pickIds, type ChatModelFactoryOptions, type LlmVendor } from './types';
import { withXaiErrorBody, withXaiRequestGuard, withXaiServerToolCheck } from './xai-chat';

/**
 * xAI Grok (PRAMI-003 §4.7, PR-1c · r3 재작업). 공식 문서 확인 2026-10-01(r3 재확인 2026-10-01) — https://docs.x.ai/developers/ 아래:
 * - 엔드포인트 `POST https://api.x.ai/v1/responses` — Responses 는 "the preferred way of interacting with our models via API",
 *   Chat Completions 는 "This legacy endpoint is deprecated" (model-capabilities/text/generate-text, …/legacy/chat-completions)
 * - 인증 "`Authorization: Bearer <xAI API key>`" (rest-api-reference/inference). 키 형식 규칙 문서 없음 → 접두 `xai-`는
 *   마스킹 힌트로만 쓰고 형식 검사는 길이·문자 집합만(접두 없는 키도 받는다, 최종 판정은 검증 호출)
 * - 검증 `GET https://api.x.ai/v1/models` — "all models available to the authenticating API key", 응답 `data[].id`, 페이지 없음
 * - 잘못된 키는 401 이 아니라 400 — 근거는 문서 문구가 아니라 더미 키 관측 본문 `{"code":"invalid-argument","error":"…"}`
 *   (r3: `debugging` 현재 400 문구는 "Check your request body or request URL." — 이전 인용은 페이지에 없어 삭제).
 *   본문 `error` 는 사람용 메시지라 폐기 고정 패턴 판정(§4.7.7 ②) 외에는 읽지 않는다
 * - 스트리밍은 "data-only server-sent events", `data: [DONE]` 으로 끝남(rest-api-reference/inference/responses).
 *   "the function call is returned in whole in a single chunk"(tools/function-calling). 이벤트 이름 목록은 문서에 없다 —
 *   `data.type` 이 OpenAI 와 같은 이름이라는 가정(UNVERIFIED)으로 @langchain/openai Responses 파서를 쓴다
 * - (r3, B-1) 실시간 검색: 레퍼런스는 아직 `search_parameters.mode`(기본 `on`)를 문서화하지만, 실제 API 는 이 키가 있으면
 *   `mode:'off'` 여도 인증보다 먼저 410 "Live search is deprecated. Please switch to the Agent Tools API" 를 돌려준다
 *   (PR #22 QA 더미 키 관측). → **`search_parameters` 를 보내지 않는다**(요청 가드가 전송 전에 막는다). 검색은 서버측 도구
 *   (web_search·x_search·코드 실행)를 `tools` 에 넣을 때만 실행되고 이 어댑터는 함수 도구만 보낸다 — 응답 `usage`
 *   (`num_server_side_tools_used`·`num_sources_used`, rest-api-reference/inference/responses)로 한 번 더 검사한다(xai-chat.ts)
 * `@langchain/xai` 는 쓰지 않는다(§4.7.2: Chat Completions·퇴역 기본 모델·@langchain/openai 이중 설치).
 */
export const XAI_API_BASE = 'https://api.x.ai/v1';

/**
 * `reasoning` 을 modelKwargs 에도 싣는 이유: 설치 버전 @langchain/openai 1.6.0 은 모델 이름이 OpenAI 추론 모델
 * (o 계열·gpt-5+)일 때만 생성자 `reasoning` 을 본문에 넣는다(`_getReasoningParams` → `isReasoningModel`). `grok-*` 은
 * 해당되지 않아 빠지므로 본문 필드로 직접 보낸다(전송 가로채기로 확인). effort low 지원: 4.7 은 model-capabilities/text/reasoning,
 * 4.3 은 migration/may-15-retirement (r3 출처 정정).
 */
const XAI_REASONING_EFFORT = 'low';

export const XAI_PROFILE: ResponsesProfile = {
  vendor: 'xai',
  baseURL: XAI_API_BASE,
  reasoningEffort: XAI_REASONING_EFFORT,
  modelKwargs: {
    reasoning: { effort: XAI_REASONING_EFFORT },
    include: ['reasoning.encrypted_content'],
  },
};

/**
 * xAI 채팅 모델 — Responses 공통 생성 + 전송 계층 3겹(xai-chat.ts): 요청 가드(전송 전) → 오류 본문 정규화 → 서버측 도구 사후 검사.
 * `profile` 인자는 테스트가 금지 키를 강제로 넣어 가드를 확인할 때만 바꾼다(AC-368 ④).
 */
export function createXaiChatModel(
  secret: string,
  model: string,
  options: ChatModelFactoryOptions,
  profile: ResponsesProfile = XAI_PROFILE,
): BaseChatModel {
  const transport = withXaiServerToolCheck(options.fetch ?? fetch, () =>
    options.onServerToolUse?.(),
  );
  const guarded = withXaiRequestGuard(withXaiErrorBody(transport));
  return createResponsesChatModel(secret, model, { ...options, fetch: guarded }, profile);
}

export const xai: LlmVendor = {
  id: 'xai',
  label: 'xAI (Grok)',
  authTypes: ['api_key'],
  keyFormat: { minLength: 16, maxLength: 256, pattern: KEY_CHARSET, hintPrefix: /^xai-/ },
  host: 'api.x.ai',
  consoleUrl: 'https://console.x.ai',
  models: modelsFor('xai'),
  verifyRequest: (secret) => ({
    url: `${XAI_API_BASE}/models`,
    headers: { authorization: `Bearer ${secret}` },
  }),
  parseModelList: (body) => {
    const ids = pickIds(body, 'data', 'id');
    return ids ? { ids, next: null } : null;
  },
  // 검증 경로 전용: 본문 없는 GET 에 400 invalid-argument = 키 문제 (Gemini 400 API_KEY_INVALID 와 같은 유형)
  isInvalidKeyResponse: (status, body) =>
    status === 400 && (body as { code?: unknown } | null)?.code === 'invalid-argument',
  // 오류 본문은 SDK 에 넘기기 전에 `{ error: { code } }` 로 정규화 — 사람용 메시지는 버린다 (xai-chat.ts)
  createChatModel: (secret, model, options) => createXaiChatModel(secret, model, options),
};
