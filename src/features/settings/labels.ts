import type { PillTone } from '@/components/ui';

/** 설정 화면 문구·상태 라벨 (PRAMI-002 §4.6.1). 서버 모듈을 import 하지 않는 순수 상수 */
export type CredentialStatusView =
  | 'unverified'
  | 'valid'
  | 'invalid'
  | 'forbidden'
  | 'rate_limited'
  | 'error'
  | 'unreadable'
  | 'unsupported';

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
};

/** 검증 실패 코드 → 사용자 문구 (벤더 원문 메시지는 쓰지 않는다, T-6) */
export const ERROR_CODE_LABELS: Record<string, string> = {
  invalid_key: '키가 유효하지 않거나 만료되었습니다',
  forbidden: '키에 필요한 권한이 없습니다',
  rate_limited: '벤더 사용 한도를 초과했습니다',
  unavailable: '벤더 응답이 없어 확인하지 못했습니다 (잠시 후 다시 검증)',
};

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
