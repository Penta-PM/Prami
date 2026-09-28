/**
 * 적용기간·운영 연도 라벨 (§4.4.4, R-04·R-12). 저장은 배타적 종료일(effective_to), 표시는 포함 종료일.
 * 서버·클라이언트 공용 순수 함수.
 */
const CURRENT = '현재';

/** YYYY-MM-DD 의 하루 전 (UTC 달력 계산이라 시간대 영향 없음) */
export function previousDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** `2022-04-01 ~ 2025-12-31` / `2026-01-01 ~ 현재` */
export function periodLabel(effectiveFrom: string, effectiveTo: string | null): string {
  return `${effectiveFrom} ~ ${effectiveTo ? previousDay(effectiveTo) : CURRENT}`;
}

/** 운영 연도(관리 화면 전용): `2022 ~ 2025` / `2026 ~ 현재` / 같은 연도면 `2024` */
export function operationYearsLabel(effectiveFrom: string, effectiveTo: string | null): string {
  const startYear = effectiveFrom.slice(0, 4);
  if (!effectiveTo) return `${startYear} ~ ${CURRENT}`;
  const endYear = previousDay(effectiveTo).slice(0, 4);
  return startYear === endYear ? startYear : `${startYear} ~ ${endYear}`;
}
