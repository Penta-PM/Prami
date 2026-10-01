import { modelsFor } from '../models';
import { createResponsesChatModel, type ResponsesProfile } from './openai-chat';
import { KEY_CHARSET, pickIds, type LlmVendor } from './types';
import { withXaiErrorBody } from './xai-chat';

/**
 * xAI Grok (PRAMI-003 §4.7, PR-1c). 공식 문서 확인 2026-10-01 — https://docs.x.ai/developers/ 아래:
 * - 엔드포인트 `POST https://api.x.ai/v1/responses` — Responses 는 "the preferred way of interacting with our models via API",
 *   Chat Completions 는 "This legacy endpoint is deprecated" (model-capabilities/text/generate-text, …/legacy/chat-completions)
 * - 인증 "`Authorization: Bearer <xAI API key>`" (rest-api-reference/inference). 키 형식 규칙 문서 없음 → 접두 `xai-`는
 *   마스킹 힌트로만 쓰고 형식 검사는 길이·문자 집합만(접두 없는 키도 받는다, 최종 판정은 검증 호출)
 * - 검증 `GET https://api.x.ai/v1/models` — "all models available to the authenticating API key", 응답 `data[].id`, 페이지 없음
 * - 잘못된 키는 401 이 아니라 400 (`debugging`: 400 "An incorrect API key was supplied."; 더미 키 관측 본문
 *   `{"code":"invalid-argument","error":"…"}`). 본문 `error` 는 사람용 메시지라 읽지 않는다
 * - 스트리밍은 "data-only server-sent events", `data: [DONE]` 으로 끝남(rest-api-reference/inference/responses).
 *   "the function call is returned in whole in a single chunk"(tools/function-calling). 이벤트 이름 목록은 문서에 없다 —
 *   `data.type` 이 OpenAI 와 같은 이름이라는 가정(UNVERIFIED)으로 @langchain/openai Responses 파서를 쓴다
 * - `search_parameters.mode` 문서 기본이 `on`(웹·X 검색) → 항상 `off`. 서버측 도구(web_search·x_search·코드 실행)는 보내지 않는다
 * `@langchain/xai` 는 쓰지 않는다(§4.7.2: Chat Completions·퇴역 기본 모델·@langchain/openai 이중 설치).
 */
export const XAI_API_BASE = 'https://api.x.ai/v1';

/**
 * `reasoning` 을 modelKwargs 에도 싣는 이유: 설치 버전 @langchain/openai 1.6.0 은 모델 이름이 OpenAI 추론 모델
 * (o 계열·gpt-5+)일 때만 생성자 `reasoning` 을 본문에 넣는다(`_getReasoningParams` → `isReasoningModel`). `grok-*` 은
 * 해당되지 않아 빠지므로 본문 필드로 직접 보낸다(전송 가로채기로 확인). 4.7·4.3 모두 effort low 지원(문서 reasoning 페이지).
 */
const XAI_REASONING_EFFORT = 'low';

export const XAI_PROFILE: ResponsesProfile = {
  vendor: 'xai',
  baseURL: XAI_API_BASE,
  reasoningEffort: XAI_REASONING_EFFORT,
  modelKwargs: {
    reasoning: { effort: XAI_REASONING_EFFORT },
    include: ['reasoning.encrypted_content'],
    search_parameters: { mode: 'off' },
  },
};

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
  createChatModel: (secret, model, options) =>
    createResponsesChatModel(
      secret,
      model,
      { ...options, fetch: withXaiErrorBody(options.fetch ?? fetch) },
      XAI_PROFILE,
    ),
};
