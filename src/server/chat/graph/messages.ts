import { LLM_API_KEY_VENDOR_LIST } from '@/lib/constants/llm-vendor-names';

import { CHAT_MAX_LENGTH } from '../intent';
import { SETUP_HREF, type SetupInfo, type SetupStatus } from './types';

/**
 * 미등록·오류 안내 문구 (PRAMI-002 §4.9, 요구 U-3) — 이 파일 한 곳. `{벤더}`는 레지스트리 라벨, `{모델}`은 상수 라벨로만
 * 치환한다(사용자 입력을 치환하지 않음). 벤더 원문 오류 메시지는 절대 쓰지 않는다(T-6).
 */
export const TRUNCATED_NOTICE = `질문이 ${CHAT_MAX_LENGTH}자를 넘어 앞 ${CHAT_MAX_LENGTH}자만 사용했습니다.`;

/** 미등록 안내 (PRAMI-003 §4.8.2 ③ 확정 문구 — 회사 발급 키 권고, 벤더 나열은 공통 상수) */
export const MISSING_MESSAGE = `LLM API 키가 등록되지 않았습니다. 사용자 설정에서 회사에서 발급한 ${LLM_API_KEY_VENDOR_LIST} 중 하나의 API 키를 등록하면 자연어로 질문할 수 있어요. 개인 API 키는 입력한 데이터가 모델 학습에 활용될 수 있으니 사용하지 마세요. 지금은 기본 응답으로 답해 드립니다.`;

/** 이후 응답의 짧은 안내 (첫 응답에만 전체 문구 — 클라이언트가 판단) */
export const MISSING_SHORT = 'LLM 미연결 — 기본 응답';

type Labels = { vendor: string; model: string };

const TEMPLATES: Record<SetupStatus, (labels: Labels) => string> = {
  missing: () => MISSING_MESSAGE,
  invalid: ({ vendor }) =>
    `등록된 ${vendor} API 키가 유효하지 않거나 만료되었습니다. 사용자 설정에서 키를 교체해주세요.`,
  forbidden: ({ vendor }) =>
    `${vendor} 키에 이 요청을 수행할 권한이 없습니다. 벤더 콘솔의 키 권한 또는 사용자 설정의 모델을 확인해주세요.`,
  unreadable: ({ vendor }) =>
    `저장된 ${vendor} 키를 읽을 수 없습니다. 사용자 설정에서 다시 등록해주세요.`,
  model_not_found: ({ model }) =>
    `선택한 모델(${model})을 사용할 수 없습니다. 사용자 설정에서 모델을 변경해주세요.`,
  rate_limited: ({ vendor }) =>
    `${vendor} 사용 한도(요청 수 또는 크레딧)를 초과했습니다. 잠시 후 다시 시도하거나 벤더 콘솔에서 한도를 확인해주세요. 이번 답변은 기본 응답입니다.`,
  unavailable: ({ vendor }) => `${vendor} 응답이 지연되고 있습니다. 이번 답변은 기본 응답입니다.`,
};

/** 지금 챗봇에서 쓸 수 없는 벤더 키만 있을 때 (관리자가 끈 OpenRouter 연결 등 — QA L-3) */
export function unsupportedVendorsMessage(labels: readonly string[]): string {
  return `${labels.join('·')} 연결은 현재 챗봇에서 사용할 수 없습니다. 사용자 설정에서 연결을 해제하거나 다른 벤더 키를 등록하세요. 이번 답변은 기본 응답입니다.`;
}

export function setupFor(status: SetupStatus, labels: Partial<Labels> = {}): SetupInfo {
  const filled = { vendor: labels.vendor ?? 'LLM', model: labels.model ?? '선택한 모델' };
  return { status, message: TEMPLATES[status](filled), href: SETUP_HREF };
}

export const REFUSED_REPLY = '이 요청은 처리할 수 없습니다.';
export const TOO_LONG_REPLY = '대화가 너무 길어졌습니다. 대화를 새로 시작해주세요.';
export const TOOL_LIMIT_NOTICE = '질문 범위가 넓어 일부만 확인했습니다.';
export const RECURSION_REPLY = '질문을 더 구체적으로 해주시면 정확히 찾아드릴게요.';
export const LLM_ERROR_NOTICE = 'LLM 응답을 받지 못해 기본 응답으로 답했습니다.';
/** 출력 상한에 걸려 답이 잘렸을 때 (PRAMI-003 §4.5.5 L-1, notice `truncated_output`) */
export const TRUNCATED_OUTPUT_NOTICE = '답변이 길어 일부만 표시합니다.';
export const EMPTY_LLM_REPLY =
  '요청하신 내용을 모두 확인하지 못했습니다. 질문을 더 구체적으로 해주세요.';
