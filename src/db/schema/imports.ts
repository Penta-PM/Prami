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
  /** 기계용 검증 코드 (PRAMI-003 §4.2.3 — duplicate_item_code, unknown_major 등). 없으면 일반 오류 */
  code?: string;
  /** 다중 파일 배치에서 오류·경고가 난 원본 파일명 */
  file?: string;
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
  /** 이하 PRAMI-003 PR-1 (품목 마스터) — 품목 배치를 적용한 run 에만 */
  itemMerge?: ItemMerge;
  /** I-10 위반(판매단가 제품군 ≠ 품목 대분류) 품번 수와 표본 — 경고, 화면은 판매단가 제품군 */
  i10Violations?: number;
  i10Samples?: string[];
  /** 파츠 매핑 종류 불일치: 모델이 본품이 아님 / 파츠가 파츠가 아님 (매핑은 유지) */
  partMappingMismatch?: { models: number; parts: number };
  /** 예외표(ITEM_KIND_OVERRIDES)에 있지만 품목 마스터에 없는 품번 (override_unknown_item) */
  overrideUnknown?: string[];
};

/** 다중 파일 배치의 원본 파일 1건 (PRAMI-003 §4.2.3). 개인정보 없음 */
export type ImportSourceFile = {
  name: string;
  sha256: string;
  rowCount: number;
  /** 파일에 있던 정규화 대분류 */
  majors: string[];
};

/** 품목 배치 적용 시 제품군 병합 방식 (PRAMI-003 §4.2.3) */
export type ItemMerge = {
  mode: 'merge' | 'replace';
  /** merge: 이번 배치에 없어 직전 값을 유지한 대분류 (replace 면 빈 배열) */
  keptMajors: string[];
  /** replace: 이번 배치에 없어 stub 으로 되돌린 대분류 (merge 면 빈 배열, QA L-3). 이 필드 이전 기록에는 없다 */
  droppedMajors?: string[];
  /** 직전 적용 품목 배치 */
  fromBatchId: string | null;
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
    /** 다중 파일 배치(품목조회)의 파일별 이름·SHA-256·행 수 (PRAMI-003 §4.2.3). 단일 파일 배치는 NULL */
    sourceFiles: jsonb('source_files').$type<ImportSourceFile[]>(),
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
    /** 품목 배치의 제품군 병합 방식 (PRAMI-003 §4.2.3) */
    itemMerge: jsonb('item_merge').$type<ItemMerge>(),
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
