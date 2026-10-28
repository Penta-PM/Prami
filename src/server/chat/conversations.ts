import 'server-only';

import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db, DbHandle } from '@/db';
import { chatConversations, chatMessages, type ChatConversationRow } from '@/db/schema/chat';
import { withTransaction, type Tx } from '@/db/tx';
import {
  autoTitle,
  CHAT_CONVERSATION_LIMIT_MESSAGE,
  CHAT_CONVERSATION_MAX,
  CHAT_CONVERSATION_NOT_FOUND,
  CHAT_MESSAGE_LIMIT_MESSAGE,
  CHAT_MESSAGE_MAX,
  normalizeTitle,
  truncateCodePoints,
  type ChatDomain,
} from '@/lib/chat/conversations';
import type { PermissionKey } from '@/lib/constants/permissions';
import { AppError } from '@/lib/result';
import { writeAudit, type RequestMeta } from '@/server/audit/log';

import { HISTORY_ITEM_MAX, type HistoryItem } from './graph/history';
import type { ChatReplyOut } from './graph/types';

/**
 * 챗봇 대화 저장소 (UX 4건 §4.2, PR-C1) — chat_conversations·chat_messages 읽기·쓰기는 이 모듈만 한다.
 * - 소유자 전용: 모든 쿼리가 `user_id = owner.userId` 를 건다. 남의 대화(ADMIN 포함)·없는 대화·잘못된 id 는 모두 NOT_FOUND(404).
 * - domain 'procurement' 는 chat.use 에 더해 procurement.read 가 있어야 한다(없으면 FORBIDDEN + 감사 denied — 데이터는 지우지 않음).
 * - **I-6 개정**: 저장하는 것은 사용자 질문, 가드를 통과한 최종 답 텍스트(ChatReply.reply)와 서버가 만든 액션(링크)뿐.
 *   도구 원본 결과·사고 블록·프롬프트·후보 목록·안내(notice)는 저장하지 않는다.
 * - history 는 서버가 DB 에서 읽는다(최근 historyMaxTurns 개, 항목당 1,000자) — 클라이언트 history 는 쓰지 않는다.
 * - 상한: 사용자·domain 당 대화 200(생성 시 CONFLICT), 대화당 메시지 400(전송 시 CONFLICT).
 * - 생성·이름 변경·삭제는 감사 audit_logs 에 **대화 id·domain 만** 남긴다(제목·내용은 개인 대화라 기록하지 않음). 같은 트랜잭션.
 * - 삭제 = 즉시 완전 삭제(메시지 CASCADE), 보관 기간 무기한(Q-U3 A).
 */
export const AUDIT_CHAT_CONVERSATION_CREATE = 'chat.conversation.create';
export const AUDIT_CHAT_CONVERSATION_RENAME = 'chat.conversation.rename';
export const AUDIT_CHAT_CONVERSATION_DELETE = 'chat.conversation.delete';
/** 조회(목록·상세) 거부 감사 키 — 성공한 조회는 감사하지 않는다 */
export const AUDIT_CHAT_CONVERSATION_READ = 'chat.conversation.read';

const AUDIT_TARGET_TYPE = 'chat.conversation';

/** 세션 사용자 기준 소유자. can = 역할 권한 검사, denied = 거부 감사(라우트가 recordAccessDenied 로 채운다) */
export type ChatOwner = {
  userId: string;
  label: string;
  can: (key: PermissionKey) => boolean;
  denied?: (key: PermissionKey) => Promise<void>;
};

export type ChatWriteContext = { handle: DbHandle; owner: ChatOwner; meta: RequestMeta };

export type ConversationView = {
  id: string;
  domain: ChatDomain;
  /** null = 아직 제목 없음(첫 질문 전) — 화면은 "새 대화" */
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredAction = { type: 'calculator'; href: string; label: string };

export type ChatMessageView = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  action: StoredAction | null;
  createdAt: string;
};

export type ConversationDetail = ConversationView & { messages: ChatMessageView[] };

const idSchema = z.uuid();

function notFound(): AppError {
  return new AppError('NOT_FOUND', CHAT_CONVERSATION_NOT_FOUND);
}

function domainAllowed(owner: ChatOwner, domain: ChatDomain): boolean {
  return domain !== 'procurement' || owner.can('procurement.read');
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', '이 작업을 수행할 권한이 없습니다');
}

/** domain 권한: procurement 는 procurement.read 추가 필요 */
export async function assertDomainAccess(owner: ChatOwner, domain: ChatDomain): Promise<void> {
  if (domainAllowed(owner, domain)) return;
  await owner.denied?.('procurement.read');
  throw forbidden();
}

/** 트랜잭션 안의 domain 거부 표식 — 거부 감사는 롤백 **뒤에** 남긴다(아래 inDomainTransaction) */
class DomainDenied extends Error {}

function assertDomainInTx(owner: ChatOwner, domain: ChatDomain): void {
  if (!domainAllowed(owner, domain)) throw new DomainDenied();
}

/**
 * 대화 행을 잠그는 트랜잭션 + domain 권한 (PR-C3): 거부 감사(owner.denied — 별도 연결로 audit_logs 기록)를 트랜잭션 안에서
 * 기다리면 단일 연결 드라이버(PGlite)에서 교착되고, 롤백될 트랜잭션 안의 대기이기도 하다 — 트랜잭션이 끝난 뒤 기록하고 FORBIDDEN.
 */
async function inDomainTransaction<T>(
  owner: ChatOwner,
  handle: DbHandle,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(fn, handle);
  } catch (error) {
    if (!(error instanceof DomainDenied)) throw error;
    await owner.denied?.('procurement.read');
    throw forbidden();
  }
}

function toView(row: ChatConversationRow): ConversationView {
  return {
    id: row.id,
    domain: row.domain,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 저장할 액션 — 서버가 만든 링크의 세 필드만, 앱 내부 경로만 (그 밖은 null) */
export function storedAction(
  action: ChatReplyOut['action'] | null | undefined,
): StoredAction | null {
  if (!action || action.type !== 'calculator') return null;
  const { href, label } = action;
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return null;
  return { type: 'calculator', href, label: String(label) };
}

function readAction(value: unknown): StoredAction | null {
  return storedAction(value as StoredAction | null);
}

function auditTarget(row: Pick<ChatConversationRow, 'id'>) {
  return { type: AUDIT_TARGET_TYPE, id: row.id, label: null };
}

/** 소유한 대화 1건 (없거나 남의 것이면 NOT_FOUND). forUpdate 면 행 잠금(트랜잭션 안에서만) */
async function findOwned(
  db: Db | Tx,
  owner: ChatOwner,
  rawId: unknown,
  forUpdate = false,
): Promise<ChatConversationRow> {
  const parsed = idSchema.safeParse(rawId);
  if (!parsed.success) throw notFound();
  const query = db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.id, parsed.data), eq(chatConversations.userId, owner.userId)))
    .limit(1);
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound();
  return row;
}

/** 목록: 본인·domain, 최근 활동 순 */
export async function listConversations(
  db: Db,
  owner: ChatOwner,
  domain: ChatDomain,
): Promise<ConversationView[]> {
  await assertDomainAccess(owner, domain);
  const rows = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.userId, owner.userId), eq(chatConversations.domain, domain)))
    .orderBy(desc(chatConversations.updatedAt), desc(chatConversations.createdAt))
    .limit(CHAT_CONVERSATION_MAX);
  return rows.map(toView);
}

/** 상세: 대화 + 메시지 전부(대화당 최대 400) */
export async function getConversation(
  db: Db,
  owner: ChatOwner,
  id: unknown,
): Promise<ConversationDetail> {
  const row = await findOwned(db, owner, id);
  await assertDomainAccess(owner, row.domain);
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, row.id))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return {
    ...toView(row),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      action: readAction(message.action),
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

/** 생성: 사용자·domain 단위 잠금 → 200개 상한 → insert → 감사(id·domain) */
export async function createConversation(
  ctx: ChatWriteContext,
  input: { domain: ChatDomain },
): Promise<ConversationView> {
  const { domain } = input;
  await assertDomainAccess(ctx.owner, domain);
  return withTransaction(async (tx) => {
    // 같은 사용자의 동시 생성으로 200개를 넘지 않게 (트랜잭션 끝에 풀림)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('chat.conversations'), hashtext(${`${ctx.owner.userId}:${domain}`}))`,
    );
    const [total] = await tx
      .select({ n: count() })
      .from(chatConversations)
      .where(
        and(eq(chatConversations.userId, ctx.owner.userId), eq(chatConversations.domain, domain)),
      );
    if ((total?.n ?? 0) >= CHAT_CONVERSATION_MAX) {
      throw new AppError('CONFLICT', CHAT_CONVERSATION_LIMIT_MESSAGE, undefined, {
        reason: 'conversation_limit',
        max: CHAT_CONVERSATION_MAX,
      });
    }
    const [row] = await tx
      .insert(chatConversations)
      .values({ userId: ctx.owner.userId, domain })
      .returning();
    if (!row) throw new Error('대화 생성 실패');
    await writeAudit(tx, {
      actor: { id: ctx.owner.userId, label: ctx.owner.label },
      action: AUDIT_CHAT_CONVERSATION_CREATE,
      target: auditTarget(row),
      after: { domain },
      meta: ctx.meta,
    });
    return toView(row);
  }, ctx.handle);
}

/** 이름 바꾸기: 앞뒤 공백 제거 1~100자. 목록 순서(updated_at)는 바꾸지 않는다. 감사에는 제목을 남기지 않는다 */
export async function renameConversation(
  ctx: ChatWriteContext,
  id: unknown,
  input: { title: unknown },
): Promise<ConversationView> {
  const checked = normalizeTitle(input?.title);
  if (!checked.ok) throw new AppError('VALIDATION', checked.message, { title: [checked.message] });
  return inDomainTransaction(ctx.owner, ctx.handle, async (tx) => {
    const current = await findOwned(tx, ctx.owner, id, true);
    assertDomainInTx(ctx.owner, current.domain);
    const [row] = await tx
      .update(chatConversations)
      .set({ title: checked.title })
      .where(
        and(eq(chatConversations.id, current.id), eq(chatConversations.userId, ctx.owner.userId)),
      )
      .returning();
    if (!row) throw notFound();
    await writeAudit(tx, {
      actor: { id: ctx.owner.userId, label: ctx.owner.label },
      action: AUDIT_CHAT_CONVERSATION_RENAME,
      target: auditTarget(row),
      after: { domain: row.domain },
      meta: ctx.meta,
    });
    return toView(row);
  });
}

/** 삭제: 즉시 완전 삭제(메시지 CASCADE). 감사에는 대화 id·domain 만 */
export async function deleteConversation(
  ctx: ChatWriteContext,
  id: unknown,
): Promise<{ id: string; domain: ChatDomain }> {
  return inDomainTransaction(ctx.owner, ctx.handle, async (tx) => {
    const current = await findOwned(tx, ctx.owner, id, true);
    assertDomainInTx(ctx.owner, current.domain);
    const [row] = await tx
      .delete(chatConversations)
      .where(
        and(eq(chatConversations.id, current.id), eq(chatConversations.userId, ctx.owner.userId)),
      )
      .returning({ id: chatConversations.id, domain: chatConversations.domain });
    if (!row) throw notFound();
    await writeAudit(tx, {
      actor: { id: ctx.owner.userId, label: ctx.owner.label },
      action: AUDIT_CHAT_CONVERSATION_DELETE,
      target: auditTarget(row),
      before: { domain: row.domain },
      meta: ctx.meta,
    });
    return row;
  });
}

export type BeginTurnInput = {
  conversationId: unknown;
  /** 요청 경로의 domain — 대화 domain 과 다르면 NOT_FOUND */
  domain: ChatDomain;
  /** 사용자가 보낸 질문(앞뒤 공백 제거) */
  message: string;
  /** 모델에 넣을 최근 history 개수 (ChatSettings.historyMaxTurns) */
  historyMaxTurns: number;
};

export type BegunTurn = { conversationId: string; history: HistoryItem[]; reused: boolean };

/**
 * 전송 1단계 (같은 트랜잭션): 소유·domain·권한 확인 → 메시지 상한 → history(이번 질문 전, DB) → 질문 저장 → 자동 제목·updated_at.
 * 답이 실패·중단되면 질문은 남는다(다시 시도 가능). 마지막 저장 메시지가 **답 없는 같은 질문**이면 새로 넣지 않고 재사용한다
 * (다시 시도로 같은 질문이 쌓이지 않게).
 */
export async function beginTurn(handle: DbHandle, owner: ChatOwner, input: BeginTurnInput) {
  return inDomainTransaction(owner, handle, async (tx): Promise<BegunTurn> => {
    const conversation = await findOwned(tx, owner, input.conversationId, true);
    if (conversation.domain !== input.domain) throw notFound();
    // 조달 대화 = procurement.read 추가 필요(PR-C3 부터 조달 도구 그래프로 답한다 — 라우트가 이 domain 으로 그래프를 고른다)
    assertDomainInTx(owner, conversation.domain);
    const recent = await tx
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(Math.max(0, input.historyMaxTurns) + 1);
    const last = recent[0];
    const reused = last?.role === 'user' && last.content === input.message;
    const [total] = await tx
      .select({ n: count() })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id));
    // 이번 턴에 들어갈 메시지 수: 질문(재사용이면 0) + 답 1
    if ((total?.n ?? 0) + (reused ? 1 : 2) > CHAT_MESSAGE_MAX) {
      throw new AppError('CONFLICT', CHAT_MESSAGE_LIMIT_MESSAGE, undefined, {
        reason: 'message_limit',
        max: CHAT_MESSAGE_MAX,
      });
    }
    const prior = (reused ? recent.slice(1) : recent).slice(0, Math.max(0, input.historyMaxTurns));
    const history: HistoryItem[] = prior
      .reverse()
      .filter((item) => item.content.length > 0)
      .map((item) => ({
        role: item.role,
        text: truncateCodePoints(item.content, HISTORY_ITEM_MAX),
      }));
    if (!reused) {
      await tx
        .insert(chatMessages)
        .values({ conversationId: conversation.id, role: 'user', content: input.message });
    }
    await tx
      .update(chatConversations)
      .set({
        updatedAt: new Date(),
        ...(conversation.title === null ? { title: autoTitle(input.message) } : {}),
      })
      .where(eq(chatConversations.id, conversation.id));
    return { conversationId: conversation.id, history, reused };
  });
}

/**
 * 전송 2단계: 가드·금지 키 검사를 통과한 최종 응답에서 **답 텍스트와 서버 액션만** 저장한다.
 * 스트림 도중 대화가 삭제됐으면 저장하지 않고 false.
 */
export async function completeTurn(
  handle: DbHandle,
  owner: ChatOwner,
  conversationId: string,
  reply: Pick<ChatReplyOut, 'reply' | 'action'>,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(eq(chatConversations.id, conversationId), eq(chatConversations.userId, owner.userId)),
      )
      .limit(1)
      .for('update');
    if (!conversation) return false;
    await tx.insert(chatMessages).values({
      conversationId,
      role: 'assistant',
      content: reply.reply,
      action: storedAction(reply.action),
    });
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    return true;
  }, handle);
}
