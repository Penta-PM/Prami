// @vitest-environment node
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

import * as rowCount from '@/server/cost/row-count';

import { createTestDb } from '../../helpers/pglite';

/**
 * PRAMI-003 원가 격리 예외(AC-42 유지): server/ops 는 개수 전용 `server/cost/row-count` 만 import 할 수 있고,
 * 다른 원가 모듈(queries 등)·모듈 루트는 여전히 막힌다. server/ops 밖에서는 row-count 도 막힌다.
 */
const ROOT = process.cwd();
const OPS_PROBE = path.join(ROOT, 'src/server/ops/__row_count_probe.tmp.ts');
const PRICING_PROBE = path.join(ROOT, 'src/features/pricing/__row_count_probe.tmp.ts');

afterAll(() => {
  for (const file of [OPS_PROBE, PRICING_PROBE]) rmSync(file, { force: true });
});

const restricted = async (file: string, source: string) => {
  writeFileSync(file, source);
  const [result] = await new ESLint({ cwd: ROOT }).lintFiles([file]);
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
};

describe('원가 행 수 전용 예외', () => {
  it('server/ops: row-count 허용, queries·모듈 루트는 거부', async () => {
    expect(
      await restricted(
        OPS_PROBE,
        "import { countMaterialCostRows } from '@/server/cost/row-count';\nexport const a = countMaterialCostRows;\n",
      ),
    ).toBe(0);
    expect(
      await restricted(
        OPS_PROBE,
        "import { getCostRows } from '@/server/cost/queries';\nimport * as c from '@/server/cost';\nexport const a = [getCostRows, c];\n",
      ),
    ).toBe(2);
  }, 180_000);

  it('server/ops 밖(features/pricing)에서는 row-count 도 거부', async () => {
    expect(
      await restricted(
        PRICING_PROBE,
        "import { countMaterialCostRows } from '@/server/cost/row-count';\nexport const a = countMaterialCostRows;\n",
      ),
    ).toBe(1);
  }, 180_000);

  it('모듈은 숫자를 돌려주는 함수만 내보낸다', async () => {
    expect(Object.keys(rowCount)).toEqual(['countMaterialCostRows']);
    const handle = await createTestDb();
    try {
      expect(await rowCount.countMaterialCostRows(handle.db)).toBe(0);
    } finally {
      await handle.close();
    }
  });
});
