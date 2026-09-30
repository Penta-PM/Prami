import type * as Registry from '@/server/llm/vendors/registry';
import { createFakeChatModel } from '@/server/llm/vendors/fake-chat';
import type { LlmVendor } from '@/server/llm/vendors/types';

/**
 * AC-242 테스트 전용 가짜 벤더 "Acme AI" — 어댑터 1개(이 객체)를 레지스트리 목록에 더하는 것만으로
 * 설정 카드·등록·검증·챗봇 경로가 동작하는지 본다. 호스트는 코드 상수(api.acme.test), 채팅은 fake 모델.
 */
export const acmeVendor: LlmVendor = {
  id: 'acme',
  label: 'Acme AI',
  authTypes: ['api_key'],
  host: 'api.acme.test',
  keyFormat: { minLength: 16, maxLength: 256, pattern: /^[A-Za-z0-9_\-.]+$/, hintPrefix: /^acme-/ },
  consoleUrl: 'https://acme.test/keys',
  models: [],
  verifyRequest: (secret) => ({
    url: 'https://api.acme.test/v1/models',
    headers: { authorization: `Bearer ${secret}` },
  }),
  parseModelList: () => null,
  createChatModel: (secret) => createFakeChatModel(secret),
};

/** vi.mock('@/server/llm/vendors/registry') 팩토리용 — 실제 레지스트리 + Acme 1줄 */
export function withAcme(actual: typeof Registry): typeof Registry {
  const vendors = [...actual.LLM_VENDORS, acmeVendor];
  return {
    ...actual,
    LLM_VENDORS: vendors,
    VENDOR_HOSTS: vendors.map((vendor) => vendor.host),
    findVendor: (id: string) => vendors.find((vendor) => vendor.id === id),
    activeVendors: (flags) => vendors.filter((vendor) => vendor.enabled?.(flags) ?? true),
  };
}
