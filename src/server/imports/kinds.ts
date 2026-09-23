import type { ImportBatch } from '@/db/schema';
import { stgItems, stgMaterialCosts, stgPartMappings, stgSalesPrices } from '@/db/schema';
import type { Tx } from '@/db/tx';
import type { PermissionKey } from '@/lib/constants/permissions';

import type { ParsedRow } from './parse-sheet';
import { COST_SPEC, type CostRow } from './schemas/costs';
import { ITEM_SPEC, type ItemRow } from './schemas/items';
import { PART_SPEC, type PartRow } from './schemas/parts';
import { SALES_SPEC, type SalesRow } from './schemas/sales';
import type { SheetSpec } from './schemas/types';

/** URL 경로의 종류 이름 (POST /api/imports/{kind}, §4.7) */
export const IMPORT_KINDS = ['sales', 'items', 'costs', 'parts'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export function isImportKind(value: string): value is ImportKind {
  return (IMPORT_KINDS as readonly string[]).includes(value);
}

/** 스테이징 INSERT 1회 행 수 (파라미터 수 제한 대비, §4.4.2 "500행 단위") */
export const STAGE_CHUNK_SIZE = 500;

type KindDefinition<Row> = {
  dbKind: ImportBatch['kind'];
  permission: PermissionKey;
  spec: SheetSpec<Row>;
  stage: (tx: Tx, batchId: string, rows: readonly ParsedRow<Row>[]) => Promise<void>;
};

async function insertChunks<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += STAGE_CHUNK_SIZE) {
    await insert(rows.slice(start, start + STAGE_CHUNK_SIZE));
  }
}

const sales: KindDefinition<SalesRow> = {
  dbKind: 'sales_price',
  permission: 'pricing.write',
  spec: SALES_SPEC,
  stage: (tx, batchId, rows) =>
    insertChunks(rows, (chunk) =>
      tx
        .insert(stgSalesPrices)
        .values(chunk.map(({ rowIndex, row }) => ({ batchId, rowIndex, ...row }))),
    ),
};

const items: KindDefinition<ItemRow> = {
  dbKind: 'item_master',
  permission: 'pricing.write',
  spec: ITEM_SPEC,
  stage: (tx, batchId, rows) =>
    insertChunks(rows, (chunk) =>
      tx.insert(stgItems).values(chunk.map(({ rowIndex, row }) => ({ batchId, rowIndex, ...row }))),
    ),
};

const costs: KindDefinition<CostRow> = {
  dbKind: 'material_cost',
  permission: 'cost.write',
  spec: COST_SPEC,
  stage: (tx, batchId, rows) =>
    insertChunks(rows, (chunk) =>
      tx
        .insert(stgMaterialCosts)
        .values(chunk.map(({ rowIndex, row }) => ({ batchId, rowIndex, ...row }))),
    ),
};

const parts: KindDefinition<PartRow> = {
  dbKind: 'part_mapping',
  permission: 'parts.write',
  spec: PART_SPEC,
  stage: (tx, batchId, rows) =>
    insertChunks(rows, (chunk) =>
      tx
        .insert(stgPartMappings)
        .values(chunk.map(({ rowIndex, row }) => ({ batchId, rowIndex, ...row }))),
    ),
};

/** 종류별 정의. 권한: 판매단가·품목 = pricing.write, 원가 = cost.write, 파츠 = parts.write (§4.6) */
export const KIND_DEFINITIONS = { sales, items, costs, parts } as const;

export type AnyKindDefinition = (typeof KIND_DEFINITIONS)[ImportKind];

export const DB_KIND_BY_KIND: Record<ImportKind, ImportBatch['kind']> = {
  sales: 'sales_price',
  items: 'item_master',
  costs: 'material_cost',
  parts: 'part_mapping',
};
