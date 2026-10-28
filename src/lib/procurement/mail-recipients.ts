/**
 * 일일 보고 메일 수신처 (수집기 Prami 이전 §2.3·§3.1 — procurement.mail_recipients). 순수 모듈 — 화면 입력 검사와 서버 검증이 같은 규칙을 쓴다.
 * 수집기는 발송 시점에 이 표를 읽고 0건이면 보내지 않는다(env·기본값 폴백 없음).
 */

/** 수신처 최대 개수 */
export const MAIL_RECIPIENT_MAX = 20;

/** 주소 최대 길이 (RFC 5321 경로 상한) */
export const MAIL_RECIPIENT_MAX_LENGTH = 254;

/** 빈 상태 문구 — 수신처 0건이면 수집기가 메일을 보내지 않는다 */
export const NO_MAIL_RECIPIENTS_TEXT = '수신처가 없어 보고 메일을 보내지 않습니다';

export const MAIL_RECIPIENT_LIMIT_MESSAGE = `수신처는 최대 ${MAIL_RECIPIENT_MAX}개까지 등록할 수 있습니다`;

/**
 * 주소 형식: ASCII 로컬 부분 @ 점이 하나 이상인 도메인(라벨은 영숫자·하이픈, 하이픈으로 시작·끝 금지).
 * ASCII 로 한정해 화면(toLowerCase)과 DB(lower(email) 고유 인덱스)의 대소문자 비교가 같은 결과를 낸다.
 */
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export type MailRecipientCheck = { ok: true; email: string } | { ok: false; message: string };

/** 입력 정규화·검사: 앞뒤 공백 제거 → 빈 값·길이·형식. 저장은 입력한 대소문자 그대로 */
export function normalizeMailRecipient(raw: unknown): MailRecipientCheck {
  if (typeof raw !== 'string') return { ok: false, message: '메일 주소를 입력하세요' };
  const email = raw.trim();
  if (!email) return { ok: false, message: '메일 주소를 입력하세요' };
  if (email.length > MAIL_RECIPIENT_MAX_LENGTH || !EMAIL_RE.test(email)) {
    return { ok: false, message: '메일 주소 형식이 아닙니다 (예: name@example.com)' };
  }
  return { ok: true, email };
}

/** 중복 비교 키 = 소문자 (DB 고유 인덱스 lower(email) 과 같은 규칙 — 형식 검사로 ASCII 만 들어온다) */
export function mailRecipientKey(email: string): string {
  return email.toLowerCase();
}

export function duplicateMailRecipientMessage(existing: string): string {
  return `이미 등록된 주소입니다: ${existing}`;
}

/** 정규화 + 대소문자 무시 중복 + 개수 상한 (화면 사전 검사 — 서버가 같은 규칙으로 다시 본다) */
export function checkMailRecipient(raw: unknown, existing: readonly string[]): MailRecipientCheck {
  const checked = normalizeMailRecipient(raw);
  if (!checked.ok) return checked;
  const key = mailRecipientKey(checked.email);
  const duplicate = existing.find((email) => mailRecipientKey(email) === key);
  if (duplicate !== undefined)
    return { ok: false, message: duplicateMailRecipientMessage(duplicate) };
  if (existing.length >= MAIL_RECIPIENT_MAX) {
    return { ok: false, message: MAIL_RECIPIENT_LIMIT_MESSAGE };
  }
  return checked;
}

/** 일일 보고 메일 결과 (수집기가 job_runs.summary.mail 에 남기는 값, §2.4) */
export const MAIL_REPORT_OUTCOMES = [
  'sent',
  'skipped_no_recipients',
  'skipped_no_smtp',
  'failed',
] as const;
export type MailReportOutcome = (typeof MAIL_REPORT_OUTCOMES)[number];

export type MailReportResult = {
  /** 알 수 없는 값·없음 = null (화면 "기록 없음") */
  outcome: MailReportOutcome | null;
  /** summary.mail_recipient_count — 0 이상 정수가 아니면 null */
  recipientCount: number | null;
};

export const NO_MAIL_REPORT_TEXT = '기록 없음';

/** job_runs.summary(jsonb) → 메일 결과. 형식이 어긋나도 예외 없이 outcome null */
export function readMailReport(summary: unknown): MailReportResult {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { outcome: null, recipientCount: null };
  }
  const record = summary as Record<string, unknown>;
  const mail = record.mail;
  const count = record.mail_recipient_count;
  return {
    outcome: MAIL_REPORT_OUTCOMES.find((value) => value === mail) ?? null,
    recipientCount:
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null,
  };
}

/** 상태 카드 문구 (§3.1) */
export function mailReportText({ outcome, recipientCount }: MailReportResult): string {
  switch (outcome) {
    case 'sent':
      return recipientCount === null ? '발송함' : `발송함 ${recipientCount}명`;
    case 'skipped_no_recipients':
      return '수신처 없음 — 보내지 않음';
    case 'skipped_no_smtp':
      return '메일 설정 없음 — 보내지 않음';
    case 'failed':
      return '발송 실패';
    case null:
      return NO_MAIL_REPORT_TEXT;
  }
}
