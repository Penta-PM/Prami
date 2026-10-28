import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import type { Db, DbHandle } from '@/db';
import { procurementBidKeywords, type ProcurementBidKeyword } from '@/db/schema/procurement';
import { withTransaction } from '@/db/tx';
import {
  bidKeywordKey,
  isBidKeywordGroup,
  normalizeBidKeyword,
  type BidKeywordGroup,
} from '@/lib/procurement/keywords';
import { AppError } from '@/lib/result';
import { writeAudit, type RequestMeta } from '@/server/audit/log';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { getCollectionStatus } from './collection';

/**
 * 키워드 관리 (조달이 통합 UI-8, `/admin/procurement?tab=keywords`, procurement.write). bid_keywords 의 추가·삭제와
 * 감사 audit_logs(`procurement.keyword.add|delete`, actorUserId)를 **같은 트랜잭션**에서 기록한다(D-8).
 * 키워드에는 조달 이력 표가 없다(원본 DDL 의 이력 표는 item_changes·delivery_changes 뿐) — 감사 로그가 유일한 이력이다.
 * 동시 편집: 이미 같은 키워드가 추가됐거나 이미 삭제된 키워드면 CONFLICT("이미 처리됨") — 화면은 안내 후 새로 불러온다.
 */

export const AUDIT_PROCUREMENT_KEYWORD_ADD = 'procurement.keyword.add';
export const AUDIT_PROCUREMENT_KEYWORD_DELETE = 'procurement.keyword.delete';

/** 동시 편집으로 이미 반영된 요청의 안내 머리말 (CONFLICT 메시지) */
export const ALREADY_PROCESSED = '이미 처리됨';

const AUDIT_TARGET_TYPE = 'procurement.bid_keyword';

export type BidKeywordView = {
  id: number;
  product: BidKeywordGroup;
  keyword: string;
  /** 직접 추가한 사람(메일의 @ 앞). 기본 키워드(created_by 없음·'기본')는 null */
  addedBy: string | null;
  createdAt: string;
};

export type BidKeywordBoard = {
  keywords: BidKeywordView[];
  /** 입찰 공고 마지막 확인 시각 (app_state `bids` 값의 last_checked) — 없으면 null */
  lastCheckedAt: string | null;
};

export type KeywordWriteContext = {
  access: ProcurementAccess;
  handle: DbHandle;
  meta: RequestMeta;
};

function addedBy(createdBy: string | null): string | null {
  if (!createdBy || createdBy === '기본') return null;
  const at = createdBy.indexOf('@');
  return at > 0 ? createdBy.slice(0, at) : createdBy;
}

function toView(row: ProcurementBidKeyword): BidKeywordView {
  return {
    id: row.id,
    product: row.product as BidKeywordGroup,
    keyword: row.keyword,
    addedBy: addedBy(row.createdBy),
    createdAt: row.createdAt.toISOString(),
  };
}

function snapshot(row: ProcurementBidKeyword) {
  return { product: row.product, keyword: row.keyword, createdBy: row.createdBy };
}

function target(row: ProcurementBidKeyword) {
  return { type: AUDIT_TARGET_TYPE, id: String(row.id), label: `${row.product} · ${row.keyword}` };
}

/** 키워드 전체(그룹 구분은 화면 — 수백 건 규모) + 마지막 확인 시각 */
export async function getBidKeywordBoard(
  access: ProcurementAccess,
  db: Db,
): Promise<BidKeywordBoard> {
  assertProcurementAccess(access, 'write');
  const [rows, status] = await Promise.all([
    db.select().from(procurementBidKeywords).orderBy(asc(procurementBidKeywords.id)),
    getCollectionStatus(access, db),
  ]);
  return {
    keywords: rows.filter((row) => isBidKeywordGroup(row.product)).map(toView),
    lastCheckedAt: status.bidsLastCheckedAt?.toISOString() ?? null,
  };
}

export type AddBidKeywordInput = { product: string; keyword: string };
export type DeleteBidKeywordInput = { id: number };

/** 추가: 검증 → (그룹·비교 키) 잠금 → 대소문자 무시 중복 확인 → insert → 감사. 중복(동시 추가 포함)은 CONFLICT */
export async function addBidKeyword(
  ctx: KeywordWriteContext,
  input: AddBidKeywordInput,
): Promise<BidKeywordView> {
  assertProcurementAccess(ctx.access, 'write');
  const product = input?.product;
  if (!isBidKeywordGroup(product)) {
    throw new AppError('VALIDATION', '키워드 그룹을 확인하세요', {
      product: ['알 수 없는 그룹입니다'],
    });
  }
  const checked = normalizeBidKeyword(input?.keyword);
  if (!checked.ok) {
    throw new AppError('VALIDATION', checked.message, { keyword: [checked.message] });
  }
  const { keyword } = checked;
  const key = bidKeywordKey(keyword);
  const conflict = (existing: string) =>
    new AppError(
      'CONFLICT',
      `${ALREADY_PROCESSED} — 이미 있는 키워드입니다: ${existing}`,
      undefined,
      { alreadyProcessed: true },
    );
  return withTransaction(async (tx) => {
    // 같은 (그룹, 비교 키) 추가를 직렬화 — 'WAF'·'waf' 동시 추가도 한쪽만 성공한다(트랜잭션 끝에 풀림)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`procurement.bid_keywords:${product}:${key}`}))`,
    );
    // 그룹 안 중복 = 라틴 문자 대소문자 무시 (DB UNIQUE 는 원본 그대로 완전 일치 — 앱 검증으로 보강)
    const [existing] = await tx
      .select({ keyword: procurementBidKeywords.keyword })
      .from(procurementBidKeywords)
      .where(
        and(
          eq(procurementBidKeywords.product, product),
          sql`lower(${procurementBidKeywords.keyword} collate "C") = ${key}`,
        ),
      )
      .limit(1);
    if (existing) throw conflict(existing.keyword);
    // ON CONFLICT DO NOTHING — 잠금 밖의 경로(이관 스크립트 등)와 겹쳐도 UNIQUE 위반 대신 CONFLICT
    const [row] = await tx
      .insert(procurementBidKeywords)
      .values({ product, keyword, createdBy: ctx.access.email })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict(keyword);
    await writeAudit(tx, {
      actor: { id: ctx.access.userId, label: ctx.access.email },
      action: AUDIT_PROCUREMENT_KEYWORD_ADD,
      target: target(row),
      after: snapshot(row),
      meta: ctx.meta,
    });
    return toView(row);
  }, ctx.handle);
}

/** 삭제: delete … returning → 감사(삭제 전 값). 이미 없으면 CONFLICT */
export async function deleteBidKeyword(
  ctx: KeywordWriteContext,
  input: DeleteBidKeywordInput,
): Promise<BidKeywordView> {
  assertProcurementAccess(ctx.access, 'write');
  const id = input?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    throw new AppError('VALIDATION', '삭제할 키워드를 확인하세요', { id: ['잘못된 키워드 번호'] });
  }
  return withTransaction(async (tx) => {
    const [row] = await tx
      .delete(procurementBidKeywords)
      .where(eq(procurementBidKeywords.id, id))
      .returning();
    if (!row) {
      throw new AppError('CONFLICT', `${ALREADY_PROCESSED} — 이미 삭제된 키워드입니다`, undefined, {
        alreadyProcessed: true,
      });
    }
    await writeAudit(tx, {
      actor: { id: ctx.access.userId, label: ctx.access.email },
      action: AUDIT_PROCUREMENT_KEYWORD_DELETE,
      target: target(row),
      before: snapshot(row),
      meta: ctx.meta,
    });
    return toView(row);
  }, ctx.handle);
}
