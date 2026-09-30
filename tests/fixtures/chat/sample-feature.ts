import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { PermissionKey } from '@/lib/constants/permissions';
import type { ChatFeature, ChatToolDef } from '@/server/chat/features/types';
import { queryRows } from '@/server/imports/sql-rows';

/**
 * AC-233 테스트 전용 기능: `notice_count`(권한 notice.read). 레지스트리 인자로만 넣어 **그래프·노드 코드 수정 없이** 라우팅되는지 본다.
 * 권한을 바꾼 변형(users.manage)은 USER 에게 노출·실행되지 않아야 한다.
 */
const input = z.object({}).strict();
const output = z.object({ count: z.number().int() }).strict();

export const noticeCountTool: ChatToolDef<typeof input, typeof output> = {
  name: 'notice_count',
  description: '게시된 공지사항 개수를 센다.',
  input,
  output,
  run: async (_args, { db }) => {
    const [row] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from notices`);
    return { data: { count: row?.n ?? 0 } };
  },
};

export function sampleFeature(permission: PermissionKey = 'notice.read'): ChatFeature {
  return {
    id: 'sample',
    title: '공지 개수 (테스트)',
    permission,
    sideEffect: 'none',
    promptHint: 'notice_count: 공지사항 개수',
    tools: [noticeCountTool],
  };
}
