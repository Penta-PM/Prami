import { anthropic } from './anthropic';
import { google } from './google';
import { openai } from './openai';
import type { LlmVendor } from './types';

export type { LlmAuthType, LlmVendor, VerifyRequest } from './types';

/**
 * LLM 벤더 레지스트리 (PRAMI-002 §4.5.1) — PR-A 는 **검증(verify) 부분**만. 채팅 모델 생성은 PR-B.
 * 벤더 추가 = 어댑터(요청 빌더) 1개 + 이 목록 1줄 + 모델 상수. DB `vendor` 는 text 라 마이그레이션이 필요 없다.
 * 벤더 baseUrl 은 코드 상수다 — 사용자·env 로 바꿀 수 없다(SSRF, T-12).
 */
/** 검증 호출이 나갈 수 있는 호스트 (코드 상수) */
export const VENDOR_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
] as const;

export const LLM_VENDORS: readonly LlmVendor[] = [anthropic, openai, google];

export function findVendor(id: string): LlmVendor | undefined {
  return LLM_VENDORS.find((vendor) => vendor.id === id);
}

/** 형식 검사 + 마스킹 힌트 접두 (fake 모드는 `fake-` 접두 키를 모든 벤더에서 받는다) */
export function isAcceptableKey(vendor: LlmVendor, secret: string, fakeMode: boolean): boolean {
  const { minLength, maxLength, pattern } = vendor.keyFormat;
  if (secret.length < minLength || secret.length > maxLength || !pattern.test(secret)) return false;
  return fakeMode || !secret.startsWith('fake-');
}
