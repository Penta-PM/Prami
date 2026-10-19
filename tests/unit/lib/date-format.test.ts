// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAuditTime } from '@/lib/audit-format';
import {
  formatDate,
  formatDateTime,
  formatDateTimeSeconds,
  formatNullableDateTime,
} from '@/lib/date-format';

/**
 * Linux 하이드레이션 수정 스펙 §3.3·§3.5: 날짜 표시는 ICU/CLDR 버전과 무관하게 같은 문자열이어야 한다
 * (SSR 과 브라우저 하이드레이션 일치). 고정 입력 → 고정 출력, 그리고 src/ 에 CLDR 종속 API 가 없음을 가드한다.
 */
describe('src/lib/date-format (KST, CLDR 비의존)', () => {
  const input = '2026-10-02T05:03:00Z'; // KST 14:03

  it('formatDateTime → YYYY-MM-DD HH:mm', () => {
    expect(formatDateTime(input)).toBe('2026-10-02 14:03');
    expect(formatDateTime(new Date(input))).toBe('2026-10-02 14:03');
  });

  it('formatDateTimeSeconds → YYYY-MM-DD HH:mm:ss, formatAuditTime 은 여기 위임(출력 불변)', () => {
    expect(formatDateTimeSeconds(input)).toBe('2026-10-02 14:03:00');
    expect(formatAuditTime(new Date(input))).toBe('2026-10-02 14:03:00');
  });

  it('formatDate → YYYY-MM-DD (KST 기준 — UTC 20시는 다음 날)', () => {
    expect(formatDate(input)).toBe('2026-10-02');
    expect(formatDate('2026-10-01T20:00:00Z')).toBe('2026-10-02');
  });

  it('자정은 00:00 (24:00 금지, hourCycle h23)', () => {
    expect(formatDateTime('2026-10-01T15:00:00Z')).toBe('2026-10-02 00:00');
    expect(formatDateTimeSeconds('2026-10-01T15:00:00Z')).toBe('2026-10-02 00:00:00');
  });

  it('formatNullableDateTime 은 값이 없으면 —', () => {
    expect(formatNullableDateTime(null)).toBe('—');
    expect(formatNullableDateTime(undefined)).toBe('—');
    expect(formatNullableDateTime(input)).toBe('2026-10-02 14:03');
  });

  it('영문 AM/PM·한글 오전/오후 가 섞이지 않는다', () => {
    const out = formatDateTime('2026-10-02T06:12:00Z'); // KST 15:12
    expect(out).toBe('2026-10-02 15:12');
    expect(out).not.toMatch(/AM|PM|오전|오후/);
  });
});

/** src/ 전체 .ts/.tsx (date-format.ts 자신 제외) */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('CLDR 종속 날짜 API 가드 (src/)', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const files = listSourceFiles(path.join(root, 'src')).filter(
    (file) => !file.endsWith(path.join('lib', 'date-format.ts')),
  );
  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('dateStyle / timeStyle 사용 0건', () => {
    const offenders = files.filter((file) =>
      /\b(dateStyle|timeStyle)\s*:/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it('인자 없는 toLocaleString()/toLocaleDateString()/toLocaleTimeString() 0건 (로케일 기본값은 환경 종속)', () => {
    const offenders = files.filter((file) =>
      /\.toLocale(Date|Time)?String\(\s*\)/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});
