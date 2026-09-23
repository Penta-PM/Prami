import { relations } from 'drizzle-orm';

import { auditLogs } from './audit';
import { importBatches, policyApplyRuns } from './imports';
import { items } from './items';
import { materialCosts } from './material-costs';
import { notices } from './notices';
import { partMappings } from './parts';
import { quoteLines, quoteShares, quotes } from './quotes';
import { salesPrices } from './sales-prices';
import { solutionGroupItems, solutionGroups } from './solution-groups';
import { stgItems, stgMaterialCosts, stgPartMappings, stgSalesPrices } from './staging';
import { users } from './users';

export const usersRelations = relations(users, ({ many }) => ({
  auditLogs: many(auditLogs),
  quotes: many(quotes),
  notices: many(notices),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }),
}));

export const importBatchesRelations = relations(importBatches, ({ one, many }) => ({
  uploader: one(users, { fields: [importBatches.uploadedBy], references: [users.id] }),
  salesPrices: many(salesPrices),
  materialCosts: many(materialCosts),
  items: many(items),
  stgSalesPrices: many(stgSalesPrices),
  stgItems: many(stgItems),
  stgMaterialCosts: many(stgMaterialCosts),
  stgPartMappings: many(stgPartMappings),
}));

export const policyApplyRunsRelations = relations(policyApplyRuns, ({ one }) => ({
  salesBatch: one(importBatches, {
    fields: [policyApplyRuns.salesBatchId],
    references: [importBatches.id],
    relationName: 'salesBatch',
  }),
  itemBatch: one(importBatches, {
    fields: [policyApplyRuns.itemBatchId],
    references: [importBatches.id],
    relationName: 'itemBatch',
  }),
  runner: one(users, { fields: [policyApplyRuns.runBy], references: [users.id] }),
}));

export const salesPricesRelations = relations(salesPrices, ({ one }) => ({
  importBatch: one(importBatches, {
    fields: [salesPrices.importBatchId],
    references: [importBatches.id],
  }),
  item: one(items, { fields: [salesPrices.itemCode], references: [items.itemCode] }),
}));

export const stgSalesPricesRelations = relations(stgSalesPrices, ({ one }) => ({
  batch: one(importBatches, { fields: [stgSalesPrices.batchId], references: [importBatches.id] }),
}));

export const stgItemsRelations = relations(stgItems, ({ one }) => ({
  batch: one(importBatches, { fields: [stgItems.batchId], references: [importBatches.id] }),
}));

export const stgMaterialCostsRelations = relations(stgMaterialCosts, ({ one }) => ({
  batch: one(importBatches, {
    fields: [stgMaterialCosts.batchId],
    references: [importBatches.id],
  }),
}));

export const stgPartMappingsRelations = relations(stgPartMappings, ({ one }) => ({
  batch: one(importBatches, {
    fields: [stgPartMappings.batchId],
    references: [importBatches.id],
  }),
}));

export const materialCostsRelations = relations(materialCosts, ({ one }) => ({
  importBatch: one(importBatches, {
    fields: [materialCosts.importBatchId],
    references: [importBatches.id],
  }),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  importBatch: one(importBatches, {
    fields: [items.importBatchId],
    references: [importBatches.id],
  }),
  salesPrices: many(salesPrices),
  partsAsModel: many(partMappings, { relationName: 'model' }),
  partsAsPart: many(partMappings, { relationName: 'part' }),
  groupMemberships: many(solutionGroupItems),
}));

export const partMappingsRelations = relations(partMappings, ({ one }) => ({
  model: one(items, {
    fields: [partMappings.modelItemCode],
    references: [items.itemCode],
    relationName: 'model',
  }),
  part: one(items, {
    fields: [partMappings.partItemCode],
    references: [items.itemCode],
    relationName: 'part',
  }),
}));

export const solutionGroupsRelations = relations(solutionGroups, ({ many }) => ({
  items: many(solutionGroupItems),
}));

export const solutionGroupItemsRelations = relations(solutionGroupItems, ({ one }) => ({
  group: one(solutionGroups, {
    fields: [solutionGroupItems.groupId],
    references: [solutionGroups.id],
  }),
  item: one(items, { fields: [solutionGroupItems.itemCode], references: [items.itemCode] }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  owner: one(users, { fields: [quotes.ownerUserId], references: [users.id] }),
  lines: many(quoteLines),
  shares: many(quoteShares),
}));

export const quoteLinesRelations = relations(quoteLines, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLines.quoteId], references: [quotes.id] }),
}));

export const quoteSharesRelations = relations(quoteShares, ({ one }) => ({
  quote: one(quotes, { fields: [quoteShares.quoteId], references: [quotes.id] }),
}));

export const noticesRelations = relations(notices, ({ one }) => ({
  author: one(users, { fields: [notices.authorUserId], references: [users.id] }),
}));
