import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { chatDomainEnum, chatMessageRoleEnum } from './enums';
import { users } from './users';

/**
 * 챗봇 대화 저장 (UX 4건 §4.2, PR-C1, 0014). **I-6 개정** — 저장 대상은 출력 가드를 통과해 사용자에게 보여 준 최종 텍스트와
 * 서버가 만든 액션(링크)뿐이다. 도구 원본 결과·사고 블록·프롬프트는 저장하지 않는다.
 * - 소유자 전용: 모든 조회·변경은 user_id = 세션 사용자로 거른다(관리자 열람 경로 없음). 사용자 삭제 시 CASCADE.
 * - title 은 null = 아직 제목 없음(첫 질문 앞 30자로 자동 지정), 사용자가 바꾸면 1~100자.
 * - 대화 삭제는 즉시 완전 삭제(메시지 CASCADE). 보관 기간 무기한(Q-U3 기본안).
 */
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    domain: chatDomainEnum('domain').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chat_conversations_user_domain_updated_idx').on(t.userId, t.domain, t.updatedAt.desc()),
    check(
      'chat_conversations_title_len_ck',
      sql`${t.title} is null or char_length(${t.title}) between 1 and 100`,
    ),
  ],
);

/** 대화 메시지. content = 사용자 질문 또는 가드 통과 최종 답변 텍스트, action = 서버가 만든 링크(ChatReply.action) 또는 null */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    role: chatMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    action: jsonb('action'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_messages_conversation_created_idx').on(t.conversationId, t.createdAt, t.id)],
);

export type ChatConversationRow = typeof chatConversations.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
