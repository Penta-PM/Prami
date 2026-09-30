import 'server-only';

import { eq } from 'drizzle-orm';

import type { Db } from '@/db';
import { users } from '@/db/schema';
import { withTransaction } from '@/db/tx';
import { AppError } from '@/lib/result';
import { AUDIT_ACTIONS, writeAudit } from '@/server/audit/log';

import {
  defaultModelFor,
  isKnownModel,
  LEGACY_LABEL,
  MODEL_TIER_LABELS,
  type LlmModelOption,
} from '../models';
import {
  acceptsApiKey,
  activeVendors,
  LLM_VENDORS,
  VENDOR_FLAGS_OFF,
  type LlmVendor,
  type VendorFlags,
} from '../vendors/registry';
import type { KeyProvider } from './keyring';
import {
  findCredentialRow,
  getOwnSettings,
  listCredentialRows,
  upsertOwnSettings,
} from './repository';
import {
  assertVendorActive,
  requireVendor,
  unreadableVendors,
  type CredentialsContext,
} from './service';
import { toCredentialView, type CredentialView } from './view';

/**
 * 사용자 설정 조회·기본값 (PRAMI-002 §4.6.1·4.12). `getMySettings` 는 세션 사용자 본인 데이터만 돌려준다(I-4).
 * 반환값에 키·암호문·`google_sub` 값이 없다(AC-204·209) — Google 연결 여부는 boolean 으로만.
 */
export type AccountView = {
  email: string;
  name: string;
  /** google: Google 계정으로 로그인한 적 있음 / test: AUTH_TEST_MODE 로그인 / pending: Google 미연결 */
  provider: 'google' | 'test' | 'pending';
  googleConnected: boolean;
  lastLoginAt: string | null;
};

export type VendorView = {
  id: string;
  label: string;
  consoleUrl: string;
  /** 키 직접 입력 가능 여부 — false 면 카드에 OAuth 연결 버튼(connectHref) */
  manualKeyEntry: boolean;
  /** OAuth 전용 벤더의 연결 시작 경로 (§4.6.2 OpenRouter) */
  connectHref: string | null;
  /** 플래그 off 벤더인데 본인 자격 증명이 남아 있음 — 카드는 안내 + 삭제만 (QA L-3) */
  disabled: boolean;
  models: (LlmModelOption & { tierLabel: string; lifecycleLabel: string | null })[];
};

export type ChatDefaultsView = {
  vendor: string | null;
  model: string | null;
  /** 저장된 모델이 상수에서 사라져 벤더 기본 모델로 대체됨 → 안내 문구 (§4.5.2) */
  modelReplaced: boolean;
};

export type MySettings = {
  account: AccountView;
  credentials: CredentialView[];
  defaults: ChatDefaultsView;
  vendors: VendorView[];
  /** KEK 가 없으면 false → 등록 버튼 비활성 + 안내 (§4.13) */
  keyringReady: boolean;
  fakeMode: boolean;
};

async function accountOf(db: Db, userId: string, testMode: boolean): Promise<AccountView> {
  const [row] = await db
    .select({
      email: users.email,
      name: users.name,
      googleSub: users.googleSub,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new AppError('NOT_FOUND', '사용자를 찾을 수 없습니다');
  const googleConnected = Boolean(row.googleSub);
  return {
    email: row.email,
    name: row.name,
    provider: googleConnected ? 'google' : testMode ? 'test' : 'pending',
    googleConnected,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

/** OAuth PKCE 연결 시작 경로 (벤더 id 로 파생 — 라우트는 벤더마다 1쌍) */
export function oauthStartHref(vendorId: string): string {
  return `/api/settings/oauth/${vendorId}/start`;
}

function toVendorView(vendor: LlmVendor, disabled = false): VendorView {
  const apiKey = acceptsApiKey(vendor) && !disabled;
  return {
    id: vendor.id,
    label: vendor.label,
    consoleUrl: vendor.consoleUrl,
    manualKeyEntry: apiKey,
    connectHref: apiKey || disabled ? null : oauthStartHref(vendor.id),
    disabled,
    models: vendor.models.map((model) => ({
      ...model,
      tierLabel: MODEL_TIER_LABELS[model.tier],
      lifecycleLabel: model.lifecycle === 'legacy' ? LEGACY_LABEL : null,
    })),
  };
}

/** 설정 화면 벤더 카드 — 플래그 off 벤더(OpenRouter)는 제외 (§4.6.2) */
export function vendorViews(
  flags: VendorFlags,
  ownedVendorIds: readonly string[] = [],
): VendorView[] {
  const active = activeVendors(flags);
  // 플래그가 꺼져도 본인 키가 남아 있으면 카드를 보여 파기할 수 있게 한다 (연결·검증·사용은 막음)
  const disabled = LLM_VENDORS.filter(
    (vendor) => !active.includes(vendor) && ownedVendorIds.includes(vendor.id),
  );
  return [
    ...active.map((vendor) => toVendorView(vendor)),
    ...disabled.map((vendor) => toVendorView(vendor, true)),
  ];
}

/** 플래그 모두 off 인 기본 목록 (API 키 3사) */
export const VENDOR_VIEWS: VendorView[] = vendorViews({ oauthOpenRouter: false });

export async function getMySettings(input: {
  db: Db;
  userId: string;
  keys: KeyProvider | null;
  mode: 'live' | 'fake';
  testMode: boolean;
  /** 벤더 노출 플래그 (env LLM_OAUTH_OPENROUTER) — 없으면 모두 off */
  flags?: VendorFlags;
}): Promise<MySettings> {
  const [account, rows, settings, unreadable] = await Promise.all([
    accountOf(input.db, input.userId, input.testMode),
    listCredentialRows(input.db, input.userId),
    getOwnSettings(input.db, input.userId),
    unreadableVendors(input.db, input.userId, input.keys),
  ]);
  return {
    account,
    credentials: rows.map((row) => toCredentialView(row, input.keys, unreadable.has(row.vendor))),
    defaults: resolveDefaults(
      settings?.chatDefaultVendor ?? null,
      settings?.chatDefaultModel ?? null,
    ),
    vendors: vendorViews(
      input.flags ?? VENDOR_FLAGS_OFF,
      rows.map((row) => row.vendor),
    ),
    keyringReady: input.keys !== null,
    fakeMode: input.mode === 'fake',
  };
}

/** 저장된 모델이 상수에 없으면 벤더 기본 모델로 대체해 보여준다 (DB 는 다음 저장 때 바뀐다) */
function resolveDefaults(vendor: string | null, model: string | null): ChatDefaultsView {
  if (!vendor || !model || isKnownModel(vendor, model))
    return { vendor, model, modelReplaced: false };
  return { vendor, model: defaultModelFor(vendor), modelReplaced: true };
}

/**
 * 본인 `valid` 자격 증명이 있는 벤더 + 모델 상수 목록의 모델 + (available_models 가 있으면) 그 교집합 안의 모델만 (AC-208, r2).
 * 그 외는 VALIDATION 이고 행은 무변경.
 */
export async function updateChatDefaults(
  ctx: CredentialsContext,
  input: { vendor: string; model: string },
): Promise<ChatDefaultsView> {
  const vendor = requireVendor(input.vendor);
  assertVendorActive(ctx, vendor);
  if (!isKnownModel(vendor.id, input.model)) {
    throw new AppError('VALIDATION', '선택할 수 없는 모델입니다');
  }
  const credential = await findCredentialRow(ctx.handle.db, ctx.actor.id, vendor.id);
  const unreadable = await unreadableVendors(ctx.handle.db, ctx.actor.id, ctx.keys);
  if (!credential || credential.status !== 'valid' || unreadable.has(vendor.id)) {
    throw new AppError('VALIDATION', '정상 검증된 키가 있는 벤더만 기본값으로 정할 수 있습니다');
  }
  if (credential.availableModels && !credential.availableModels.includes(input.model)) {
    throw new AppError('VALIDATION', '이 키로 사용할 수 없는 모델입니다');
  }
  return withTransaction(async (tx) => {
    const before = await getOwnSettings(tx, ctx.actor.id);
    const saved = await upsertOwnSettings(tx, ctx.actor.id, {
      chatDefaultVendor: vendor.id,
      chatDefaultModel: input.model,
    });
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_ACTIONS.llmDefaultUpdate,
      target: { type: 'user_settings', id: ctx.actor.id, label: ctx.actor.label },
      before: {
        vendor: before?.chatDefaultVendor ?? null,
        model: before?.chatDefaultModel ?? null,
      },
      after: { vendor: saved.chatDefaultVendor, model: saved.chatDefaultModel },
      meta: ctx.meta,
    });
    return { vendor: saved.chatDefaultVendor, model: saved.chatDefaultModel, modelReplaced: false };
  }, ctx.handle);
}
