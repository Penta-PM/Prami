import { getDb, getDbHandle } from '@/db';
import { isChatDomain, type ChatDomain } from '@/lib/chat/conversations';
import { AppError } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runRoute } from '@/server/auth/rbac';
import { chatOwner } from '@/server/chat/conversation-owner';
import { noStoreJson, readJsonObject } from '@/server/chat/conversation-route';
import {
  AUDIT_CHAT_CONVERSATION_CREATE,
  AUDIT_CHAT_CONVERSATION_READ,
  createConversation,
  listConversations,
} from '@/server/chat/conversations';

/**
 * 챗봇 대화 목록·생성 (UX 4건 §4.2, PR-C1, chat.use — procurement 는 procurement.read 추가).
 * - GET  /api/chat/conversations?domain=pricing|procurement → 본인 대화(최근 활동 순, 최대 200) `{ id, domain, title, createdAt, updatedAt }[]`
 * - POST /api/chat/conversations `{ domain }` → 201 새 대화(title null — 첫 질문 앞 30자로 자동). 200개 상한 → 409 CONFLICT
 */
const TARGET = '/api/chat/conversations';

function domainOf(value: unknown): ChatDomain {
  if (!isChatDomain(value)) throw new AppError('VALIDATION', '챗봇 구분(domain)을 확인하세요');
  return value;
}

export async function GET(request: Request): Promise<Response> {
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_CONVERSATION_READ,
    target: TARGET,
  } as const;
  return runRoute(guard, async (user) => {
    const domain = domainOf(new URL(request.url).searchParams.get('domain'));
    const owner = chatOwner(user, TARGET, AUDIT_CHAT_CONVERSATION_READ);
    return noStoreJson(await listConversations(await getDb(), owner, domain));
  });
}

export async function POST(request: Request): Promise<Response> {
  const guard = {
    permission: 'chat.use',
    auditAction: AUDIT_CHAT_CONVERSATION_CREATE,
    target: TARGET,
  } as const;
  return runRoute(guard, async (user) => {
    const body = await readJsonObject(request);
    const extra = Object.keys(body).filter((key) => key !== 'domain');
    if (extra.length) throw new AppError('VALIDATION', '요청 본문을 확인하세요');
    const domain = domainOf(body.domain);
    const created = await createConversation(
      {
        handle: await getDbHandle(),
        owner: chatOwner(user, TARGET, AUDIT_CHAT_CONVERSATION_CREATE),
        meta: await currentRequestMeta(),
      },
      { domain },
    );
    return noStoreJson(created, 201);
  });
}
