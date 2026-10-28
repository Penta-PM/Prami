/**
 * 날짜·시각 표시 공용 포맷 (서버·클라이언트 모두 사용). 항상 한국 시간(Asia/Seoul).
 *
 * CLDR 비의존 (Linux 하이드레이션 수정 스펙 §3.3): `dateStyle`/`timeStyle`/`hour12` 는 ICU·CLDR 버전에 따라 출력이
 * 달라진다 — Node 24(ICU 78)는 `26. 10. 2. PM 3:12`, Chromium 은 `26. 10. 2. 오후 3:12` 를 내서 'use client'
 * 컴포넌트의 SSR 과 하이드레이션 결과가 어긋나 React 가 트리를 다시 그렸다(/settings 먹통). 그래서 숫자 필드만 지정하고
 * `sv-SE` 로케일(ISO 8601 순서 `YYYY-MM-DD HH:mm:ss`)과 `hourCycle: 'h23'`(자정 `00:00`, `24:00` 금지)을 쓴다.
 * 이 파일 밖에서 `dateStyle`/`timeStyle` 을 쓰지 않는다 — tests/unit/lib/date-format.test.ts 가 src/ 전체를 검사한다.
 */

type DateInput = string | Date;

const KST_NUMERIC = {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
} as const satisfies Intl.DateTimeFormatOptions;

const dateFormat = new Intl.DateTimeFormat('sv-SE', KST_NUMERIC);
const dateTimeFormat = new Intl.DateTimeFormat('sv-SE', {
  ...KST_NUMERIC,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateTimeSecondsFormat = new Intl.DateTimeFormat('sv-SE', {
  ...KST_NUMERIC,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 한국 시간 `YYYY-MM-DD` */
export function formatDate(value: DateInput): string {
  return dateFormat.format(toDate(value));
}

/** 한국 시간 `YYYY-MM-DD HH:mm` */
export function formatDateTime(value: DateInput): string {
  return dateTimeFormat.format(toDate(value));
}

/** 한국 시간 `YYYY-MM-DD HH:mm:ss` (감사 로그·CSV) */
export function formatDateTimeSeconds(value: DateInput): string {
  return dateTimeSecondsFormat.format(toDate(value));
}

/** 값이 없으면 `—` (설정 화면의 마지막 검증·사용·로그인) */
export function formatNullableDateTime(value: DateInput | null | undefined): string {
  return value ? formatDateTime(value) : '—';
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 상대 시각 (챗봇 대화 목록, UX PR-C2): 1분 미만 "방금", 1시간 미만 "N분 전", 24시간 미만 "N시간 전", 7일 미만 "N일 전",
 * 그 밖은 한국 시간 `YYYY-MM-DD`. 미래 시각(시계 차이)은 "방금". 클라이언트에서만 그린다(SSR 하이드레이션 차이 방지).
 */
export function formatRelativeTime(value: DateInput, now: DateInput = new Date()): string {
  const diff = toDate(now).getTime() - toDate(value).getTime();
  if (diff < MINUTE_MS) return '방금';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}분 전`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}시간 전`;
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}일 전`;
  return formatDate(value);
}
