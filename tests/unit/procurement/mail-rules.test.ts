import { describe, expect, it } from 'vitest';

import {
  checkMailRecipient,
  MAIL_RECIPIENT_MAX,
  mailReportText,
  NO_MAIL_RECIPIENTS_TEXT,
  normalizeMailRecipient,
  readMailReport,
} from '@/lib/procurement/mail-recipients';

/** 수집기 Prami 이전 §3.1 — 수신처 입력 규칙 + 상태 카드 문구(job_runs.summary.mail). 합성 주소만 */
describe('normalizeMailRecipient', () => {
  it('앞뒤 공백 제거, 대소문자는 입력 그대로 저장', () => {
    expect(normalizeMailRecipient('  Report.Team@Example.com \t')).toEqual({
      ok: true,
      email: 'Report.Team@Example.com',
    });
  });

  it.each([
    ['', '메일 주소를 입력하세요'],
    ['   ', '메일 주소를 입력하세요'],
    [undefined, '메일 주소를 입력하세요'],
    ['no-at.example.com', '형식'],
    ['a@b', '형식'],
    ['a b@example.com', '형식'],
    ['a@-example.com', '형식'],
    ['한글@example.com', '형식'],
    ['a@example.com\u0007', '형식'],
    [`${'x'.repeat(250)}@example.com`, '형식'],
  ])('%j → 거부(%s)', (raw, message) => {
    const result = normalizeMailRecipient(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });
});

describe('checkMailRecipient', () => {
  it('대소문자 무시 중복 → 기존 주소를 알려 준다', () => {
    expect(checkMailRecipient(' OPS@example.invalid ', ['ops@example.invalid'])).toEqual({
      ok: false,
      message: '이미 등록된 주소입니다: ops@example.invalid',
    });
  });

  it(`${MAIL_RECIPIENT_MAX}개면 더 추가할 수 없다 (형식 오류가 먼저)`, () => {
    const existing = Array.from({ length: MAIL_RECIPIENT_MAX }, (_, i) => `r${i}@example.com`);
    expect(checkMailRecipient('new@example.com', existing)).toEqual({
      ok: false,
      message: '수신처는 최대 20개까지 등록할 수 있습니다',
    });
    expect(checkMailRecipient('bad', existing)).toMatchObject({ ok: false });
    expect(checkMailRecipient('new@example.com', existing.slice(1))).toEqual({
      ok: true,
      email: 'new@example.com',
    });
  });

  it('빈 상태 문구', () => {
    expect(NO_MAIL_RECIPIENTS_TEXT).toBe('수신처가 없어 보고 메일을 보내지 않습니다');
  });
});

describe('상태 카드 문구 (readMailReport → mailReportText)', () => {
  const text = (summary: unknown) => mailReportText(readMailReport(summary));

  it('4가지 결과', () => {
    expect(text({ mail: 'sent', mail_recipient_count: 3 })).toBe('발송함 3명');
    expect(text({ mail: 'skipped_no_recipients', mail_recipient_count: 0 })).toBe(
      '수신처 없음 — 보내지 않음',
    );
    expect(text({ mail: 'skipped_no_smtp' })).toBe('메일 설정 없음 — 보내지 않음');
    expect(text({ mail: 'failed', mail_recipient_count: 2 })).toBe('발송 실패');
  });

  it('없음·모르는 값·형식이 어긋난 summary 는 예외 없이 "기록 없음"', () => {
    for (const summary of [
      null,
      undefined,
      'sent',
      42,
      ['sent'],
      {},
      { mail: 'queued' },
      { mail: 1 },
      { mail: { status: 'sent' } },
    ]) {
      expect(text(summary)).toBe('기록 없음');
    }
  });

  it('sent 인데 수신자 수가 정수가 아니면 숫자 없이 "발송함"', () => {
    for (const count of [undefined, '3', -1, 1.5, null]) {
      expect(text({ mail: 'sent', mail_recipient_count: count })).toBe('발송함');
    }
    expect(text({ mail: 'sent', mail_recipient_count: 0 })).toBe('발송함 0명');
  });
});
