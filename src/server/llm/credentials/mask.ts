import type { LlmVendor } from '../vendors/types';

/**
 * 마스킹 힌트 (PRAMI-002 §4.10, Q-11): 벤더의 알려진 접두(예 `sk-`, `AIza`, fake 모드 `fake-`)만 남기고 `…` + 끝 4자.
 * 끝 4자는 영숫자만 센다(`_`·`-`·`.` 는 건너뜀) — DB CHECK `^[A-Za-z-]{0,8}…[A-Za-z0-9]{4}$` 와 맞춘다.
 * 힌트는 화면 식별용이다. 감사 로그에는 넣지 않는다.
 */
export const HINT_ELLIPSIS = '…';
const FAKE_PREFIX = /^fake-/;

function knownPrefix(vendor: LlmVendor, secret: string): string {
  const match = vendor.keyFormat.hintPrefix.exec(secret) ?? FAKE_PREFIX.exec(secret);
  const prefix = match?.[0] ?? '';
  // 접두는 영문·하이픈 8자까지만 (DB CHECK)
  return /^[A-Za-z-]{0,8}$/.test(prefix) ? prefix : '';
}

export function lastAlnum(secret: string, count = 4): string | null {
  const alnum = secret.replace(/[^A-Za-z0-9]/g, '');
  return alnum.length >= count ? alnum.slice(-count) : null;
}

export function maskKey(vendor: LlmVendor, secret: string): string | null {
  const tail = lastAlnum(secret);
  if (!tail) return null;
  return `${knownPrefix(vendor, secret)}${HINT_ELLIPSIS}${tail}`;
}
