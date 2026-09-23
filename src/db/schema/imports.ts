import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns';
import { applyRunStatusEnum, importKindEnum, importStatusEnum } from './enums';
import { users } from './users';

/** 행 오류 항목 (최대 500건 저장, §4.3.3) */
export type ImportRowError = {
  /** 엑셀 행 번호 (1-base, 사용자가 엑셀에서 보는 번호). 파일 단위 오류는 0 */
  row: number;
  column: string;
  message: string;
  value?: unknown;
};

/** 가격정책 적용 결과 통계 (§4.3.3) */
export type PolicyApplyStats = {
  inserted: number;
  seriesCount: number;
  latestCount: number;
  discardedForced: number;
  missingItems: number;
  manualPreserved: number;
  manualConflicts: number;
  /** 이하 PR-3 추가 (검증·리포트용) */
  operatingCount: number;
  itemsApplied: number;
  unmappedItemStatus: number;
  /** 원본 최종여부 ≠ 산정 is_latest_in_series 인 ERP 행 수 (AC-21) */
  finalSourceMismatch: number;
};

/** 업로드된 원본 파일 1건 (§4.3.3). 파싱 결과는 stg_* 스테이징 테이블에 저장 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: importKindEnum('kind').notNull(),
    fileName: text('file_name').notNull(),
    /** 동일 파일 재업로드 감지 — kind 별 UNIQUE */
    fileSha256: text('file_sha256').notNull(),
    fileSize: integer('file_size').notNull(),
    /** 원본 보관 위치(Vercel Blob 키 등). 1차는 보관하지 않음 */
    storageRef: text('storage_ref'),
    /** 감지된 헤더 행 (0-base). ERP 원본은 1, 병합본은 0 */
    headerRowIndex: integer('header_row_index').notNull().default(0),
    rowCount: integer('row_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    status: importStatusEnum('status').notNull().default('parsed'),
    errors: jsonb('errors').$type<ImportRowError[]>().notNull().default([]),
    /** 무시한 추가 컬럼·매핑 불가 값 등 적용을 막지 않는 경고 (§4.4.1) */
    warnings: jsonb('warnings').$type<ImportRowError[]>().notNull().default([]),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('import_batches_kind_sha256_uq').on(t.kind, t.fileSha256),
    index('import_batches_kind_status_idx').on(t.kind, t.status),
  ],
);

/** "가격정책 적용" 1회 실행 (§4.3.3). 현재 유효 상태 = status='succeeded' 인 최신 run */
export const policyApplyRuns = pgTable(
  'policy_apply_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesBatchId: uuid('sales_batch_id')
      .notNull()
      .references(() => importBatches.id),
    /** 품목조회 파일이 아직 없을 때 NULL */
    itemBatchId: uuid('item_batch_id').references(() => importBatches.id),
    salesReused: boolean('sales_reused').notNull().default(false),
    itemReused: boolean('item_reused').notNull().default(false),
    status: applyRunStatusEnum('status').notNull().default('running'),
    stats: jsonb('stats').$type<PolicyApplyStats>(),
    /** 실패 사유 (status='failed') */
    error: text('error'),
    runBy: uuid('run_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('policy_apply_runs_status_started_idx').on(t.status, t.startedAt.desc())],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type PolicyApplyRun = typeof policyApplyRuns.$inferSelect;
