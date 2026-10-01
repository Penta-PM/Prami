import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns';
import { llmAuthTypeEnum, llmCredentialStatusEnum } from './enums';
import { users } from './users';

/**
 * 사용자 LLM 자격 증명 (PRAMI-002 §4.10). 평문 컬럼은 없다 — 봉투 암호화(§4.7.1)의 암호문·IV·태그와
 * KEK 로 감싼 DEK, 마스킹 힌트만 저장한다. 이 스키마는 `server/llm/credentials/**` 에서만 import 한다(ESLint, T-7).
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

export const userLlmCredentials = pgTable(
  'user_llm_credentials',
  {
    /** 앱에서 먼저 생성한다 — AAD 에 포함 (§4.7.1) */
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 레지스트리로 검증하는 text (pg enum 아님 — 벤더 추가 시 마이그레이션 불필요) */
    vendor: text('vendor').notNull(),
    authType: llmAuthTypeEnum('auth_type').notNull(),
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    secretIv: bytea('secret_iv').notNull(),
    secretTag: bytea('secret_tag').notNull(),
    dekWrapped: bytea('dek_wrapped').notNull(),
    dekIv: bytea('dek_iv').notNull(),
    dekTag: bytea('dek_tag').notNull(),
    kekVersion: integer('kek_version').notNull(),
    keyHint: text('key_hint').notNull(),
    status: llmCredentialStatusEnum('status').notNull().default('unverified'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    /** 정규화 코드만 (벤더 메시지 저장 금지, T-6) */
    lastErrorCode: text('last_error_code'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** 검증 시 벤더 목록 API ∩ models.ts 상수 (r2 §4.5.2). NULL = 미확인(검증 전·목록 호출 실패) — 상수 전체 허용 */
    availableModels: text('available_models').array(),
    /**
     * 자격 증명 만료 (PRAMI-003 §4.4.3, 0007). NULL = 비만료(기본 — OpenRouter PKCE 흐름은 만료를 지정할 수 없다).
     * 지나면 챗봇은 invalid(재연결 안내), 설정 카드는 "재연결 필요", 검증은 벤더 호출 없이 code=expired.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('user_llm_credentials_user_vendor_uq').on(t.userId, t.vendor),
    index('user_llm_credentials_kek_version_idx').on(t.kekVersion),
    check('user_llm_credentials_vendor_ck', sql`${t.vendor} ~ '^[a-z][a-z0-9_]{1,31}$'`),
    check('user_llm_credentials_secret_iv_ck', sql`octet_length(${t.secretIv}) = 12`),
    check('user_llm_credentials_secret_tag_ck', sql`octet_length(${t.secretTag}) = 16`),
    check('user_llm_credentials_dek_wrapped_ck', sql`octet_length(${t.dekWrapped}) = 32`),
    check('user_llm_credentials_dek_iv_ck', sql`octet_length(${t.dekIv}) = 12`),
    check('user_llm_credentials_dek_tag_ck', sql`octet_length(${t.dekTag}) = 16`),
    check('user_llm_credentials_kek_version_ck', sql`${t.kekVersion} >= 1`),
    check(
      'user_llm_credentials_key_hint_ck',
      sql`${t.keyHint} ~ '^[A-Za-z-]{0,8}…[A-Za-z0-9]{4}$'`,
    ),
  ],
);

export type UserLlmCredential = typeof userLlmCredentials.$inferSelect;
export type NewUserLlmCredential = typeof userLlmCredentials.$inferInsert;
