import 'server-only';

import { eq } from 'drizzle-orm';

import type { Db } from '@/db';
import { users } from '@/db/schema';
import { withTransaction } from '@/db/tx';
import { AppError } from '@/lib/result';
import { AUDIT_ACTIONS, writeAudit } from '@/server/audit/log';

import { isKnownModel, MODEL_TIER_LABELS, type LlmModelOption } from '../models';
import { LLM_VENDORS } from '../vendors/registry';
import type { KeyProvider } from './keyring';
import {
  findCredentialRow,
  getOwnSettings,
  listCredentialRows,
  upsertOwnSettings,
} from './repository';
import { requireVendor, type CredentialsContext } from './service';
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
  models: (LlmModelOption & { tierLabel: string })[];
};

export type ChatDefaultsView = { vendor: string | null; model: string | null };

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

export const VENDOR_VIEWS: VendorView[] = LLM_VENDORS.map((vendor) => ({
  id: vendor.id,
  label: vendor.label,
  consoleUrl: vendor.consoleUrl,
  models: vendor.models.map((model) => ({ ...model, tierLabel: MODEL_TIER_LABELS[model.tier] })),
}));

export async function getMySettings(input: {
  db: Db;
  userId: string;
  keys: KeyProvider | null;
  mode: 'live' | 'fake';
  testMode: boolean;
}): Promise<MySettings> {
  const [account, rows, settings] = await Promise.all([
    accountOf(input.db, input.userId, input.testMode),
    listCredentialRows(input.db, input.userId),
    getOwnSettings(input.db, input.userId),
  ]);
  return {
    account,
    credentials: rows.map((row) => toCredentialView(row, input.keys)),
    defaults: {
      vendor: settings?.chatDefaultVendor ?? null,
      model: settings?.chatDefaultModel ?? null,
    },
    vendors: VENDOR_VIEWS,
    keyringReady: input.keys !== null,
    fakeMode: input.mode === 'fake',
  };
}

/** 본인 `valid` 자격 증명이 있는 벤더 + 모델 상수 목록의 모델만 (AC-208) */
export async function updateChatDefaults(
  ctx: CredentialsContext,
  input: { vendor: string; model: string },
): Promise<ChatDefaultsView> {
  const vendor = requireVendor(input.vendor);
  if (!isKnownModel(vendor.id, input.model)) {
    throw new AppError('VALIDATION', '선택할 수 없는 모델입니다');
  }
  const credential = await findCredentialRow(ctx.handle.db, ctx.actor.id, vendor.id);
  if (!credential || credential.status !== 'valid') {
    throw new AppError('VALIDATION', '정상 검증된 키가 있는 벤더만 기본값으로 정할 수 있습니다');
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
    return { vendor: saved.chatDefaultVendor, model: saved.chatDefaultModel };
  }, ctx.handle);
}
