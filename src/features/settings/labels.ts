import type { PillTone } from '@/components/ui';
import { LLM_API_KEY_VENDOR_LIST } from '@/lib/constants/llm-vendor-names';

/** 설정 화면 문구·상태 라벨 (PRAMI-002 §4.6.1). 서버 모듈을 import 하지 않는 순수 상수 */
export type CredentialStatusView =
  | 'unverified'
  | 'valid'
  | 'invalid'
  | 'forbidden'
  | 'rate_limited'
  | 'error'
  | 'unreadable'
  | 'unsupported'
  | 'expired';

export const STATUS_LABELS: Record<
  CredentialStatusView | 'missing',
  { label: string; tone: PillTone }
> = {
  missing: { label: '미등록', tone: 'neutral' },
  unverified: { label: '검증 대기', tone: 'neutral' },
  valid: { label: '정상', tone: 'positive' },
  invalid: { label: '키 무효', tone: 'red' },
  forbidden: { label: '권한 부족', tone: 'red' },
  rate_limited: { label: '한도 초과', tone: 'amber' },
  error: { label: '확인 실패', tone: 'amber' },
  unreadable: { label: '재등록 필요', tone: 'red' },
  unsupported: { label: '지원 종료', tone: 'neutral' },
  // PRAMI-003 §4.4.3 (AC-346): expires_at 경과
  expired: { label: '재연결 필요', tone: 'red' },
};

/** 검증 실패 코드 → 사용자 문구 (벤더 원문 메시지는 쓰지 않는다, T-6) */
export const ERROR_CODE_LABELS: Record<string, string> = {
  invalid_key: '키가 유효하지 않거나 만료되었습니다',
  forbidden: '키에 필요한 권한이 없습니다',
  rate_limited: '벤더 사용 한도를 초과했습니다',
  unavailable: '벤더 응답이 없어 확인하지 못했습니다 (잠시 후 다시 검증)',
  expired: '연결이 만료되었습니다 — 다시 연결하세요',
};

/** 만료된 OAuth 연결 카드 안내 (PRAMI-003 §4.4.3 확정 문구) */
export function expiredNotice(vendorLabel: string): string {
  return `${vendorLabel} 연결이 만료되었습니다 — 다시 연결하세요`;
}

/**
 * OAuth 연결 카드의 한도 안내 (PRAMI-003 §4.4.3) — PKCE 흐름은 한도를 지정할 수 없어 벤더 대시보드에서 키별로 설정하게 한다.
 */
export function oauthLimitNotice(vendorLabel: string, keyLabel: string): string {
  return `사용 한도(크레딧)는 ${vendorLabel} 대시보드에서 키 "${keyLabel}"에 직접 설정하세요. 앱에서는 한도를 지정할 수 없습니다.`;
}

/**
 * OAuth 연결 해제 후 안내 (PRAMI-003 §4.4.3, AC-347) — 앱 저장본은 즉시 파기됐지만 벤더 쪽 키는 앱이 폐기할 수 없다.
 */
export function oauthDisconnectNotice(vendorLabel: string, keyLabel: string): string {
  return `${vendorLabel} 연결을 해제하고 앱에 저장된 키를 파기했습니다. 앱에서는 ${vendorLabel} 쪽 키를 폐기할 수 없으니 ${vendorLabel} 대시보드에서 키 "${keyLabel}"를 삭제하세요.`;
}

/** 변조·KEK 누락으로 복호화할 수 없는 키 (QA L-1) */
export const UNREADABLE_NOTICE = '키를 읽을 수 없습니다 — 다시 등록하세요';

type VerifiedView = {
  vendorLabel: string;
  status: CredentialStatusView;
  lastErrorCode: string | null;
};

/**
 * 저장·검증 결과 알림 (QA L-2): 결과 코드별로 문구·톤을 나눈다. 정상일 때만 성공 톤.
 * 확인 실패(unavailable)는 상태가 바뀌지 않으므로 status 보다 lastErrorCode 를 먼저 본다.
 */
export function verifyResultMessage(
  view: VerifiedView,
  kind: 'save' | 'verify',
): { tone: 'ok' | 'error'; text: string } {
  const saved = kind === 'save' ? '저장했지만 ' : '';
  if (view.status === 'unreadable')
    return { tone: 'error', text: `${view.vendorLabel}: ${UNREADABLE_NOTICE}` };
  if (view.lastErrorCode === 'unavailable') {
    return {
      tone: 'error',
      text: `${view.vendorLabel} 키를 ${saved}벤더 응답이 없어 확인하지 못했습니다 — 잠시 후 [검증]을 다시 누르세요`,
    };
  }
  if (view.status === 'valid') {
    const text = kind === 'save' ? '키를 저장하고 검증했습니다' : '키 검증을 마쳤습니다 — 정상';
    return { tone: 'ok', text: `${view.vendorLabel} ${text}` };
  }
  const reason = ERROR_CODE_LABELS[view.lastErrorCode ?? ''] ?? STATUS_LABELS[view.status].label;
  return { tone: 'error', text: `${view.vendorLabel} 키를 ${saved}사용할 수 없습니다: ${reason}` };
}

export const NOTICES = [
  '사용 요금은 등록한 본인 벤더 계정으로 청구됩니다.',
  '질문 내용과 조회된 판매단가가 선택한 LLM 벤더로 전송됩니다. 원가 정보는 전송되지 않습니다.',
  '키는 암호화되어 저장되며 관리자를 포함해 누구도 열람할 수 없습니다.',
] as const;

/**
 * 회사 API 키 주의 문구 (PRAMI-003 §4.8.1 확정 문구 — 변경은 Plan 재검토). 모든 벤더 공통, 벤더 이름을 넣지 않는다.
 * TITLE·BODY = LLM 연결 섹션 상단 안내, FORM_HINT = 키 등록·교체 폼 입력란 바로 위.
 */
export const COMPANY_KEY_WARNING_TITLE = '회사 API 키를 사용하세요';
export const COMPANY_KEY_WARNING_BODY =
  '개인 API 키를 사용하면 입력한 질문과 조회된 판매단가 등 민감한 업무 데이터가 벤더의 모델 학습에 활용될 수 있습니다. 업무에는 반드시 회사에서 발급한 API 키를 사용하세요.';
export const COMPANY_KEY_FORM_HINT =
  '회사에서 발급한 API 키만 입력하세요. 개인 키는 입력한 데이터가 모델 학습에 활용될 수 있습니다.';

/** 설정 화면 미등록 문구 (벤더 나열은 챗봇 미등록 안내와 같은 공통 상수, §4.8.2) */
export const NO_CREDENTIAL_NOTICE = `아직 등록한 LLM API 키가 없습니다. ${LLM_API_KEY_VENDOR_LIST} 중 하나의 키를 등록하면 챗봇에서 자연어로 질문할 수 있게 됩니다.`;

/** PR-B 머지 전까지 고정 (§6.1) */
/** PR-B 부터 챗봇이 이 기본값으로 LLM 을 호출한다 (PR-A 의 "곧 제공됩니다" 문구는 §6.1 대로 제거) */
export const CHAT_DEFAULTS_CAPTION = '챗봇이 자연어 질문에 이 벤더·모델을 씁니다';

/** available_models 밖 모델 (r2 §4.5.2, AC-208) */
export const MODEL_UNAVAILABLE_LABEL = '이 키로 사용 불가';

export const MODEL_REPLACED_NOTICE = '선택한 모델이 더 이상 제공되지 않아 기본 모델로 바뀌었습니다';

export const DELETE_DONE_MESSAGE =
  '키를 삭제했습니다. 벤더 콘솔에서도 키를 폐기하는 것을 권장합니다.';

export const KEYRING_MISSING_NOTICE =
  '서버에 암호화 키가 설정되지 않았습니다(관리자 문의). 키를 등록할 수 없습니다.';

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
