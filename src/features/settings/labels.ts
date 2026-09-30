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

export const NOTICES = [
  '사용 요금은 등록한 본인 벤더 계정으로 청구됩니다.',
  '질문 내용과 조회된 판매단가가 선택한 LLM 벤더로 전송됩니다. 원가 정보는 전송되지 않습니다.',
  '키는 암호화되어 저장되며 관리자를 포함해 누구도 열람할 수 없습니다.',
] as const;

/** PR-B 머지 전까지 고정 (§6.1) */
export const CHAT_LLM_COMING_SOON = '챗봇 LLM 연결은 곧 제공됩니다';

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
