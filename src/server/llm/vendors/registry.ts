import { anthropic } from './anthropic';
import { google } from './google';
import { openai } from './openai';
import { openrouter } from './openrouter';
import type { LlmVendor, VendorFlags } from './types';
import { xai } from './xai';

export type { LlmAuthType, LlmVendor, ModelListPage, VendorFlags, VerifyRequest } from './types';

/**
 * LLM 벤더 레지스트리 (PRAMI-002 §4.5.1). 설정 화면 카드·검증·챗봇 모델 생성이 모두 여기서 파생한다.
 * **벤더 추가 = 어댑터 파일 1개 + 이 목록 1줄 + 모델 상수**(AC-242). DB `vendor` 는 text 라 마이그레이션이 필요 없다.
 * 벤더 호스트는 코드 상수다 — 사용자·env 로 바꿀 수 없다(SSRF, T-12).
 */
export const LLM_VENDORS: readonly LlmVendor[] = [anthropic, openai, google, xai, openrouter];

/** 검증 호출이 나갈 수 있는 호스트 (벤더 상수에서 파생) */
export const VENDOR_HOSTS: readonly string[] = LLM_VENDORS.map((vendor) => vendor.host);

export function findVendor(id: string): LlmVendor | undefined {
  return LLM_VENDORS.find((vendor) => vendor.id === id);
}

/** 플래그로 켜진 벤더인지 (플래그 없는 벤더는 항상 켜짐) */
export function isVendorActive(vendor: LlmVendor, flags: VendorFlags): boolean {
  return vendor.enabled?.(flags) ?? true;
}

/** 모든 플래그 off — 플래그를 모르는 호출자의 안전한 기본값 (OpenRouter 는 꺼짐) */
export const VENDOR_FLAGS_OFF: VendorFlags = { oauthOpenRouter: false };

/** 설정 화면·연결 라우트·챗봇에서 쓸 벤더 (플래그 off 벤더는 연결·사용 불가 — OpenRouter §4.6.2) */
export function activeVendors(flags: VendorFlags): LlmVendor[] {
  return LLM_VENDORS.filter((vendor) => isVendorActive(vendor, flags));
}

/** 키 직접 입력을 받는 벤더인지 (OAuth 전용 벤더는 카드에 연결 버튼) */
export function acceptsApiKey(vendor: LlmVendor): boolean {
  return vendor.authTypes.includes('api_key');
}

/** 형식 검사 + 마스킹 힌트 접두 (fake 모드는 `fake-` 접두 키를 모든 벤더에서 받는다) */
export function isAcceptableKey(vendor: LlmVendor, secret: string, fakeMode: boolean): boolean {
  const { minLength, maxLength, pattern } = vendor.keyFormat;
  if (secret.length < minLength || secret.length > maxLength || !pattern.test(secret)) return false;
  return fakeMode || !secret.startsWith('fake-');
}
