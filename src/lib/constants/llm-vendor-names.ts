/**
 * API 키를 직접 등록할 수 있는 LLM 벤더 약칭 나열 (PRAMI-003 §4.8.2 ③). 챗봇 미등록 안내·설정 화면 미등록 문구가 같이 쓴다.
 * 클라이언트 컴포넌트도 쓰므로 서버 레지스트리를 import 하지 않는 상수다 — 레지스트리와 같은지는 단위 테스트가 비교한다
 * (벤더 추가 시 안내 누락 방지, AC-360 ③).
 */
export const LLM_API_KEY_VENDOR_NAMES = ['Anthropic', 'OpenAI', 'Google', 'xAI'] as const;

export const LLM_API_KEY_VENDOR_LIST = LLM_API_KEY_VENDOR_NAMES.join('·');
