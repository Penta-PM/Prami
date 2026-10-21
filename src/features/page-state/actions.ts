'use server';

import { z } from 'zod';

import { getDb } from '@/db';
import { PAGE_KEYS, PAGE_PERMISSIONS, VIEW_QUERY_MAX_BYTES } from '@/lib/page-state/keys';
import { fail, type ActionResult } from '@/lib/result';
import { runAction } from '@/server/auth/rbac';
import { normalizeViewQuery } from '@/server/page-state/normalize';
import { VIEW_SCROLL_TOP_MAX, writeViewQuery, writeViewScroll } from '@/server/page-state/store';

/**
 * 조회 상태 저장 Server Actions (page-state-memory §2.2-3·§2.3-1·§2.7-2).
 * - page_key 화이트리스트 밖은 VALIDATION(저장 거부). 그 화면을 여는 권한이 없으면 FORBIDDEN(+감사 denied).
 * - user_id 는 세션에서만 — 입력에 user_id 가 있어도 쓰지 않는다(스키마에 없음 → 버려짐).
 * - 쿼리는 그 화면의 파서를 통과한 정규화 결과만 저장하고, 2KB 를 넘으면 저장하지 않는다(rejected).
 * - 감사 로그는 남기지 않는다(화면 조회 조건 — 행위 아님).
 */
const RAW_QUERY_MAX = VIEW_QUERY_MAX_BYTES * 4;

const pageKeySchema = z.enum(PAGE_KEYS);
const querySchema = z.string().max(RAW_QUERY_MAX);

const saveQuerySchema = z.object({ pageKey: pageKeySchema, query: querySchema });
const saveScrollSchema = z.object({
  pageKey: pageKeySchema,
  query: querySchema,
  top: z.number().finite().min(0).max(VIEW_SCROLL_TOP_MAX),
});

type SaveResult = { status: 'saved' | 'rejected' };

const invalid = () => fail('VALIDATION', '저장할 수 없는 화면 상태입니다');

export async function saveViewStateAction(input: {
  pageKey: string;
  query: string;
}): Promise<ActionResult<SaveResult>> {
  const parsed = saveQuerySchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { pageKey, query } = parsed.data;
  return runAction(
    {
      permission: PAGE_PERMISSIONS[pageKey],
      auditAction: 'view_state.save',
      name: 'saveViewState',
    },
    async (user) => {
      const db = await getDb();
      const normalized = await normalizeViewQuery(db, { role: user.role }, pageKey, query);
      return { status: await writeViewQuery(db, user.id, pageKey, normalized) };
    },
  );
}

export async function saveViewScrollAction(input: {
  pageKey: string;
  query: string;
  top: number;
}): Promise<ActionResult<SaveResult>> {
  const parsed = saveScrollSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { pageKey, query, top } = parsed.data;
  return runAction(
    {
      permission: PAGE_PERMISSIONS[pageKey],
      auditAction: 'view_state.save_scroll',
      name: 'saveViewScroll',
    },
    async (user) => {
      const db = await getDb();
      const normalized = await normalizeViewQuery(db, { role: user.role }, pageKey, query);
      return {
        status: await writeViewScroll(db, user.id, pageKey, {
          query: normalized,
          top: Math.round(top),
        }),
      };
    },
  );
}
