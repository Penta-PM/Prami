import 'server-only';

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import type { Db } from '@/db';

import { defaultModelFor, isKnownModel } from '../models';
import { createFakeChatModel } from '../vendors/fake-chat';
import {
  findVendor,
  isVendorActive,
  LLM_VENDORS,
  VENDOR_FLAGS_OFF,
  type LlmVendor,
  type VendorFlags,
} from '../vendors/registry';
import type { ChatModelFactoryOptions } from '../vendors/types';
import { CredentialUnreadableError } from './crypto';
import type { KeyProvider } from './keyring';
import {
  getOwnSettings,
  listCredentialRows,
  touchLastUsed,
  updateOwnStatus,
  type CredentialRow,
} from './repository';
import { withDecryptedSecret } from './service';

/**
 * 챗봇용 자격 증명 해석 (PRAMI-002 §4.3.2 resolveCredential). 세션 사용자 **본인** 행만 읽는다(I-4).
 * 복호화는 여기서 한 번 — 결과는 키를 캡처한 모델 팩토리(`createModel`)뿐이고, 키 문자열 필드는 어디에도 없다(I-3).
 * 자격 증명은 캐시하지 않는다 — 설정에서 저장한 직후 다음 질문부터 LLM 경로(§4.9 "등록 후 즉시 사용").
 */
export type ChatCredentialStatus = 'ready' | 'missing' | 'invalid' | 'forbidden' | 'unreadable';

export type ResolvedChatCredential = {
  status: ChatCredentialStatus;
  vendor: string | null;
  vendorLabel: string | null;
  model: string | null;
  credentialId: string | null;
  /** ready 일 때만. 호출할 때마다 새 모델 인스턴스 (요청 스코프) */
  createModel: ((options: ChatModelFactoryOptions) => BaseChatModel) | null;
  /**
   * 지금 챗봇에서 쓸 수 없는 벤더의 키 — 채팅 어댑터 없음 또는 플래그 off(OpenRouter, QA L-3) — 안내 문구용 라벨.
   * 이 벤더 키는 복호화·호출하지 않는다.
   */
  unsupportedVendorLabels: string[];
};

type ResolveInput = {
  db: Db;
  userId: string;
  keys: KeyProvider | null;
  mode: 'live' | 'fake';
  /** 벤더 노출 플래그 (env LLM_OAUTH_OPENROUTER) — 없으면 모두 off */
  flags?: VendorFlags;
};

const NONE: Omit<ResolvedChatCredential, 'status' | 'unsupportedVendorLabels'> = {
  vendor: null,
  vendorLabel: null,
  model: null,
  credentialId: null,
  createModel: null,
};

const chatCapable = (vendor: LlmVendor | undefined, flags: VendorFlags): vendor is LlmVendor =>
  vendor !== undefined && Boolean(vendor.createChatModel) && isVendorActive(vendor, flags);

/** 기본 벤더 → 없으면 레지스트리 순서상 첫 valid → 없으면 첫 행 (상태를 보여 주기 위해) */
function pickRow(rows: CredentialRow[], defaultVendor: string | null): CredentialRow | null {
  const ordered = LLM_VENDORS.flatMap((vendor) => rows.filter((row) => row.vendor === vendor.id));
  return (
    ordered.find((row) => row.vendor === defaultVendor) ??
    ordered.find((row) => row.status === 'valid') ??
    ordered[0] ??
    null
  );
}

function pickModel(row: CredentialRow, settings: Awaited<ReturnType<typeof getOwnSettings>>) {
  const saved = settings?.chatDefaultVendor === row.vendor ? settings.chatDefaultModel : null;
  const usable = (model: string) =>
    isKnownModel(row.vendor, model) &&
    (!row.availableModels || row.availableModels.includes(model));
  if (saved && usable(saved)) return saved;
  return defaultModelFor(row.vendor);
}

function statusOf(row: CredentialRow): ChatCredentialStatus | null {
  if (row.status === 'invalid') return 'invalid';
  if (row.status === 'forbidden') return 'forbidden';
  // valid·unverified·rate_limited·error 는 호출해 본다 (확정적으로 나쁜 키만 막는다)
  return null;
}

export async function resolveChatCredential(input: ResolveInput): Promise<ResolvedChatCredential> {
  const [rows, settings] = await Promise.all([
    listCredentialRows(input.db, input.userId),
    getOwnSettings(input.db, input.userId),
  ]);
  const flags = input.flags ?? VENDOR_FLAGS_OFF;
  const usable = rows.filter((row) => chatCapable(findVendor(row.vendor), flags));
  // 확정적으로 나쁜 키(invalid·forbidden)가 아닌데 쓸 수 없는 벤더 — OAuth 연결은 unverified 로 저장된다
  const unsupportedVendorLabels = rows
    .filter((row) => statusOf(row) === null && findVendor(row.vendor) && !usable.includes(row))
    .map((row) => findVendor(row.vendor)?.label ?? row.vendor);
  const row = pickRow(usable, settings?.chatDefaultVendor ?? null);
  if (!row) return { status: 'missing', ...NONE, unsupportedVendorLabels };
  const vendor = findVendor(row.vendor) as LlmVendor;
  const model = pickModel(row, settings);
  const base = { vendor: vendor.id, vendorLabel: vendor.label, model, credentialId: row.id };
  const bad = statusOf(row);
  if (bad) return { status: bad, ...base, createModel: null, unsupportedVendorLabels };
  const createModel = await openFactory(input, vendor, model ?? '');
  if (!createModel)
    return { status: 'unreadable', ...base, createModel: null, unsupportedVendorLabels };
  return { status: 'ready', ...base, createModel, unsupportedVendorLabels };
}

/** 키를 캡처한 팩토리. 복호화 실패(KEK 없음·변조)면 null */
async function openFactory(
  input: ResolveInput,
  vendor: LlmVendor,
  model: string,
): Promise<ResolvedChatCredential['createModel']> {
  try {
    return await withDecryptedSecret(
      { handle: { db: input.db }, keys: input.keys },
      input.userId,
      vendor.id,
      async (secret) => (options: ChatModelFactoryOptions) =>
        input.mode === 'fake'
          ? createFakeChatModel(secret)
          : vendor.createChatModel!(secret, model, options),
    );
  } catch (error) {
    if (error instanceof CredentialUnreadableError) return null;
    throw error;
  }
}

export async function markChatCredentialUsed(
  db: Db,
  userId: string,
  resolved: Pick<ResolvedChatCredential, 'vendor' | 'credentialId'>,
): Promise<void> {
  if (!resolved.vendor || !resolved.credentialId) return;
  await touchLastUsed(db, userId, resolved.vendor, resolved.credentialId);
}

/** 채팅 호출이 인증 계열 오류면 자격 증명 상태를 갱신한다 (§4.8.3 — invalid·forbidden) */
export async function markChatCredentialRejected(
  db: Db,
  userId: string,
  resolved: Pick<ResolvedChatCredential, 'vendor' | 'credentialId'>,
  status: 'invalid' | 'forbidden',
): Promise<void> {
  if (!resolved.vendor || !resolved.credentialId) return;
  await updateOwnStatus(db, userId, resolved.vendor, resolved.credentialId, {
    status,
    lastErrorCode: status === 'invalid' ? 'invalid_key' : 'forbidden',
  });
}
