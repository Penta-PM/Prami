/**
 * PRAMI-003 재현에서 얻은 실제 OpenAI 실패 응답 형태 (비밀값 제거). 2026-10-01 로컬 :3000, fixture-admin, gpt-6-luna,
 * Chat Completions + 함수 도구 3개 → HTTP 400. 진단 로그로 확인한 필드: type `invalid_request_error`, param `reasoning_effort`,
 * code 없음. 벤더 메시지 원문은 로그 계약(T-6·T-17)상 수집하지 않았으므로 자리표시자다. 요청 ID 는 가짜 값.
 */
export const OPENAI_TOOLS_REASONING_400 = {
  status: 400,
  headers: { 'x-request-id': 'req_fixture_prami003' },
  body: {
    error: {
      message: 'FIXTURE-MESSAGE-NOT-COLLECTED (벤더 원문은 로그에 남기지 않는다)',
      type: 'invalid_request_error',
      param: 'reasoning_effort',
      code: null,
    },
  },
};
