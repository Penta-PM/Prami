import { getDb, getDbHandle } from '@/db';
import { AppError } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runRoute } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import { chatOwner } from '@/server/chat/conversation-owner';
import { noStoreJson, readJsonObject } from '@/server/chat/conversation-route';
import {
  AUDIT_CHAT_CONVERSATION_DELETE,
  AUDIT_CHAT_CONVERSATION_READ,
  AUDIT_CHAT_CONVERSATION_RENAME,
  deleteConversation,
  getConversation,
  renameConversation,
} from '@/server/chat/conversations';

/**
 * 챗봇 대화 1건 (UX 4건 §4.2, PR-C1, chat.use — procurement 대화는 procurement.read 추가). 남의 대화(ADMIN 포함)·없는 id → 404.
 * - GET    → `{ id, domain, title, createdAt, updatedAt, messages: { id, role, content, action, createdAt }[] }`
 * - PATCH  `{ title }` → 이름 바꾸기(앞뒤 공백 제거 1~100자, 아니면 400)
 * - DELETE → 즉시 완전 삭제(메시지 CASCADE) `{ id, domain }`. 감사 chat.conversation.delete 에 id·domain 만
 */
type RouteContext = { params: Promise<{ id: string }> };

const target = (id: string) => `/api/chat/conversations/${encodeURIComponent(id).slice(0, 80)}`;

async function writeContext(user: SessionUser, path: string, action: string) {
  return {
    handle: await getDbHandle(),
    owner: chatOwner(user, path, action),
    meta: await currentRequestMeta(),
  };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const path = target(id);
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_CONVERSATION_READ,
    target: path,
  } as const;
  return runRoute(guard, async (user) =>
    noStoreJson(
      await getConversation(await getDb(), chatOwner(user, path, AUDIT_CHAT_CONVERSATION_READ), id),
    ),
  );
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const path = target(id);
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_CONVERSATION_RENAME,
    target: path,
  } as const;
  return runRoute(guard, async (user) => {
    const body = await readJsonObject(request);
    if (Object.keys(body).some((key) => key !== 'title')) {
      throw new AppError('VALIDATION', '요청 본문을 확인하세요');
    }
    const ctx = await writeContext(user, path, AUDIT_CHAT_CONVERSATION_RENAME);
    return noStoreJson(await renameConversation(ctx, id, { title: body.title }));
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const path = target(id);
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_CONVERSATION_DELETE,
    target: path,
  } as const;
  return runRoute(guard, async (user) => {
    const ctx = await writeContext(user, path, AUDIT_CHAT_CONVERSATION_DELETE);
    return noStoreJson(await deleteConversation(ctx, id));
  });
}
