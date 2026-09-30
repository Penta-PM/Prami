import { randomBytes } from 'node:crypto';

import { expect } from 'vitest';

/**
 * PRAMI-002 §9.2 노출 검사: 전체 일치 + 12자 창 슬라이딩 부분 일치가 모두 없어야 한다 (AC-203·204).
 * "키 K" 는 테스트가 만든 가짜 키 — 접두 + 무작위 32자.
 */
export const WINDOW = 12;

export function makeFakeKey(prefix = 'fake-valid-'): string {
  return `${prefix}${randomBytes(24).toString('base64url').slice(0, 32)}`;
}

export function findSecretLeak(haystack: string, secret: string): string | null {
  if (haystack.includes(secret)) return secret;
  for (let start = 0; start + WINDOW <= secret.length; start += 1) {
    const window = secret.slice(start, start + WINDOW);
    if (haystack.includes(window)) return window;
  }
  return null;
}

export function expectNoSecret(haystack: string, secret: string, where = '대상'): void {
  const leak = findSecretLeak(haystack, secret);
  expect(leak, `${where} 에 키 일부("${leak?.slice(0, 4)}…")가 노출됨`).toBeNull();
}
