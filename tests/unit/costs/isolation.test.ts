// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { parsePriceFilter } from '@/features/pricing/filter';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';
import { applyPolicy } from '@/server/imports/apply-policy';
import { getCategoryOptions } from '@/server/pricing/categories';
import { getPriceRowDetail, getPriceRows } from '@/server/pricing/queries';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/** AC-42 ESLint 격리 룰 (위반 파일 생성 후 lint 실패 확인) + AC-43 공개 응답에 원가 키 없음 (스냅샷) */
const ROOT = process.cwd();
const VIOLATION = path.join(ROOT, 'src/features/pricing/__cost_violation.tmp.ts');
const ALLOWED = path.join(ROOT, 'src/features/costs/__cost_allowed.tmp.ts');
const SOURCE =
  "import { getCostRows } from '@/server/cost/queries';\nexport const keep = getCostRows;\n";

describe('AC-42 server/cost import 제한', () => {
  const eslint = new ESLint({ cwd: ROOT });

  afterAll(() => {
    for (const file of [VIOLATION, ALLOWED]) rmSync(file, { force: true });
  });

  it('허용 목록 밖(features/pricing)에서 import 하면 no-restricted-imports 오류', async () => {
    mkdirSync(path.dirname(VIOLATION), { recursive: true });
    writeFileSync(VIOLATION, SOURCE);
    const [result] = await eslint.lintFiles([VIOLATION]);
    expect(result?.errorCount).toBeGreaterThanOrEqual(1);
    expect(result?.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
    expect(result?.messages[0]?.message).toContain('server/cost');
  }, 60_000);

  it('동적 import()·require·materialCosts 스키마 직접 사용도 막는다 (PR-5 QA LOW-2)', async () => {
    const cases: [string, string][] = [
      [
        'dynamic',
        [
          'export async function f() {',
          "  return (await import('@/server/cost/queries')).getCostRows;",
          '}',
          '',
        ].join('\n'),
      ],
      [
        'schema',
        [
          "import { materialCosts } from '@/db/schema';",
          'export const t = materialCosts;',
          '',
        ].join('\n'),
      ],
      [
        'schema-file',
        [
          "import { materialCosts } from '@/db/schema/material-costs';",
          'export const t = materialCosts;',
          '',
        ].join('\n'),
      ],
    ];
    for (const [name, source] of cases) {
      const file = path.join(ROOT, `src/features/pricing/__cost_${name}.tmp.ts`);
      writeFileSync(file, source);
      try {
        const [result] = await eslint.lintFiles([file]);
        const rules = result?.messages.map((m) => m.ruleId) ?? [];
        expect(result?.errorCount, name).toBeGreaterThanOrEqual(1);
        expect(
          rules.some((rule) => rule === 'no-restricted-syntax' || rule === 'no-restricted-imports'),
          name,
        ).toBe(true);
      } finally {
        rmSync(file, { force: true });
      }
    }
  }, 90_000);

  it('허용 목록(features/costs)에서는 통과 — 동적 import 포함', async () => {
    const dynamicImport = [
      'export async function g() {',
      "  return (await import('@/server/cost/queries')).getCostRows;",
      '}',
      '',
    ].join('\n');
    writeFileSync(ALLOWED, `${SOURCE}${dynamicImport}`);
    const [result] = await eslint.lintFiles([ALLOWED]);
    expect(
      result?.messages.filter(
        (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax',
      ),
    ).toEqual([]);
  }, 60_000);
});

describe('AC-43 공개 쿼리 응답에 unit_cost·material_code 없음', () => {
  let handle: DbHandle;
  const COST_KEYS = /unit_cost|unitCost|material_code|materialCode|material_costs/;

  beforeAll(async () => {
    handle = await createTestDb();
    const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
    await applyPolicy(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
    );
    const costs = await uploadFixture(handle, 'costs', 'costs-sample.xlsx');
    await applyCostImport(
      { handle, access: costAccessForTests({ id: null, email: 'vitest' }), meta: TEST_META },
      { batchId: costs.batchId, reused: false },
    );
  });

  afterAll(async () => {
    await handle.close();
  });

  it('getPriceRows · getPriceRowDetail · getCategoryOptions JSON 스냅샷 키 검사', async () => {
    const page = await getPriceRows(handle.db, parsePriceFilter({}).filter);
    const detail = await getPriceRowDetail(handle.db, page.rows[0]!.id);
    const options = await getCategoryOptions(handle.db, {});
    for (const payload of [page, detail, options]) {
      const json = JSON.stringify(payload);
      expect(json.length).toBeGreaterThan(50);
      expect(json).not.toMatch(COST_KEYS);
    }
    expect(Object.keys(page.rows[0]!).sort()).toEqual(
      [
        'currency',
        'effectiveFrom',
        'effectiveTo',
        'id',
        'itemCode',
        'itemName',
        'itemStatus',
        'major',
        'mid',
        'minor',
        'operationStatus',
        'priceType',
        'remark',
        'source',
        'unitPrice',
      ].sort(),
    );
  });
});
