import type { PillTone } from '@/components/ui';

/**
 * 입찰 공고 표 표시 규칙 (조달이 통합 UI-3) — 순수 함수. 원본 화면(조달이 입찰공고 관리)의 구조를 따른다:
 * 적합도 상·중·하 + 점수, 마감 D-day(3일 이내 = 임박), 마감일 없는 공고는 "마감일 미표기".
 * 색만으로 구분하지 않는다 — 배지마다 글자(등급·D-day·임박·마감)가 있다.
 */

// ── 적합도 ───────────────────────────────────────────────────────────

export type FitBadge = {
  /** 배지 글자 (등급 — 없으면 '—') */
  grade: string;
  /** 점수 글자 (`87점`, 없으면 null) */
  score: string | null;
  tone: PillTone;
  /** 보조기기용 전체 문장 */
  label: string;
};

/** Pill 톤 — 상 = success(S700 on S50), 중 = warning(W700 on W50), 하 = neutral (모두 4.5:1 이상, tokens.test) */
const FIT_TONE: Record<string, PillTone> = { 상: 'positive', 중: 'amber', 하: 'neutral' };

export function fitBadge(grade: string | null, score: number | null): FitBadge {
  const scoreText = typeof score === 'number' && Number.isFinite(score) ? `${score}점` : null;
  if (!grade) {
    return {
      grade: '—',
      score: scoreText,
      tone: 'neutral',
      label: scoreText ? `적합도 등급 없음, ${scoreText}` : '적합도 없음',
    };
  }
  return {
    grade,
    score: scoreText,
    tone: FIT_TONE[grade] ?? 'neutral',
    label: `적합도 ${grade}${scoreText ? `, ${scoreText}` : ''}`,
  };
}

// ── 마감 D-day ───────────────────────────────────────────────────────

/** 이 날 수 이하로 남으면 임박 (원본 화면 규칙: 3일 이내) */
export const BID_URGENT_DAYS = 3;

export type DeadlineTone = 'urgent' | 'open' | 'closed' | 'none';

export type DeadlineBadge = { text: string; tone: DeadlineTone };

/**
 * 서버가 계산한 closed·daysLeft(KST 날짜 차) → 배지.
 * - 마감 시각 없음 → "마감일 미표기"(D-day 빈칸). 공고 후 14일이 지나 서버가 마감으로 본 공고는 마감 색(원본 화면과 같음)
 * - 마감됨 → "마감"
 * - 오늘 마감 → "오늘 마감"(임박), 1~3일 → "D-n 임박", 그 뒤 → "D-n"
 */
export function deadlineBadge(row: {
  deadlineAt: Date | string | null;
  closed: boolean;
  daysLeft: number | null;
}): DeadlineBadge {
  if (!row.deadlineAt || row.daysLeft === null)
    return { text: '마감일 미표기', tone: row.closed ? 'closed' : 'none' };
  if (row.closed) return { text: '마감', tone: 'closed' };
  const days = Math.max(0, row.daysLeft);
  if (days === 0) return { text: '오늘 마감', tone: 'urgent' };
  if (days <= BID_URGENT_DAYS) return { text: `D-${days} 임박`, tone: 'urgent' };
  return { text: `D-${days}`, tone: 'open' };
}

/**
 * 배지 색. 임박 = `--accent-orange`(Warning 500) 채움 + 기본 글자(N900, 8.4:1 — 흰 글자는 2.2:1 이라 쓰지 않는다).
 * 진행 = Primary 배지(P700 on P50), 마감·미표기 = 회색 배지(N600 on N100). 모두 글자 4.5:1 이상 (Penta PR-4d).
 */
export const DEADLINE_TONE_CLASS: Record<DeadlineTone, string> = {
  urgent: 'bg-accent-orange text-text-primary',
  open: 'bg-primary-50 text-primary-700',
  closed: 'bg-neutral-100 text-text-secondary',
  none: 'bg-neutral-100 text-text-secondary',
};

// ── 근거 ─────────────────────────────────────────────────────────────

export type ReasonSign = 'plus' | 'minus' | 'none';

export type FitReason = { sign: ReasonSign; text: string };

const PLUS = /^\s*[+＋]\s*/;
const MINUS = /^\s*[-－−]\s*/;

/** 근거 문장 앞의 ＋/－(전각·반각) → 부호 + 나머지 문장 */
export function parseFitReason(reason: string): FitReason {
  if (PLUS.test(reason)) return { sign: 'plus', text: reason.replace(PLUS, '') };
  if (MINUS.test(reason)) return { sign: 'minus', text: reason.replace(MINUS, '') };
  return { sign: 'none', text: reason.trim() };
}

export function reasonCounts(reasons: readonly string[]): { plus: number; minus: number } {
  let plus = 0;
  let minus = 0;
  for (const reason of reasons) {
    const { sign } = parseFitReason(reason);
    if (sign === 'plus') plus += 1;
    else if (sign === 'minus') minus += 1;
  }
  return { plus, minus };
}

// ── 외부 링크 ────────────────────────────────────────────────────────

/** 공고 상세 링크는 http(s) 만 링크로 만든다(javascript: 등 차단) */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
