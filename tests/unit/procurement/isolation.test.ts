// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

import * as procurementSchemaModule from '@/db/schema/procurement';

/**
 * 조달이 통합 DB-2 격리 규칙: procurement 스키마·server/procurement 는 조달 경로(server/procurement, features/procurement,
 * app/(app)/procurement, app/(app)/admin/procurement)에서만. 위반 파일을 만들어 lint 실패를 확인한다(원가 AC-42 패턴).
 */
const ROOT = process.cwd();
const created: string[] = [];
/** 테스트가 새로 만든 디렉터리 (아직 없는 조달 경로) — 끝나면 비어 있을 때만 지운다 */
const createdDirs: string[] = [];

function write(rel: string, source: string): string {
  const file = path.join(ROOT, rel);
  const dir = path.dirname(file);
  if (!existsSync(dir)) {
    const first = mkdirSync(dir, { recursive: true });
    if (first) createdDirs.push(first);
  }
  writeFileSync(file, source);
  created.push(file);
  return file;
}

function restricted(result: ESLint.LintResult | undefined) {
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax',
  );
}

afterAll(() => {
  for (const file of created) rmSync(file, { force: true });
  for (const dir of createdDirs.reverse()) {
    // 맨 위 새 디렉터리부터 아래로 비어 있으면 지운다 (테스트 도중 다른 파일이 생겼으면 남긴다)
    const nested: string[] = [];
    const collect = (current: string) => {
      if (!existsSync(current)) return;
      nested.push(current);
      for (const entry of readdirSync(current, { withFileTypes: true }))
        if (entry.isDirectory()) collect(path.join(current, entry.name));
    };
    collect(dir);
    for (const current of nested.reverse()) {
      if (readdirSync(current).length === 0) rmdirSync(current);
    }
  }
});

const VIOLATIONS: [string, string][] = [
  [
    'module',
    "import { getBidNoticeRows } from '@/server/procurement/queries';\nexport const keep = getBidNoticeRows;\n",
  ],
  [
    'module-root',
    "import * as procurement from '@/server/procurement';\nexport const keep = procurement;\n",
  ],
  [
    'relative',
    "import { getBidNoticeRows } from '../../server/procurement/queries';\nexport const keep = getBidNoticeRows;\n",
  ],
  [
    'dynamic',
    "export async function f() {\n  return (await import('@/server/procurement/queries')).getBidNoticeRows;\n}\n",
  ],
  ['require', "export const m = require('@/server/procurement/queries');\n"],
  [
    'schema-name',
    "import { procurementDeliveries } from '@/db/schema';\nexport const t = procurementDeliveries;\n",
  ],
  [
    'schema-type',
    "import type { ProcurementBidNotice } from '@/db/schema';\nexport type T = ProcurementBidNotice;\n",
  ],
  [
    'schema-file',
    "import { procurementItems } from '@/db/schema/procurement';\nexport const t = procurementItems;\n",
  ],
  [
    'schema-subfile',
    "import { procurementVProductDeliveries } from '@/db/schema/procurement/views';\nexport const t = procurementVProductDeliveries;\n",
  ],
  [
    'schema-object',
    "import { schema } from '@/db';\nexport const t = schema.procurementBidNotices;\n",
  ],
  [
    'relational',
    "import { getDb } from '@/db';\nexport async function f() {\n  return (await getDb()).query.procurementItems.findMany();\n}\n",
  ],
  [
    'rawsql-template',
    "import { sql } from 'drizzle-orm';\nexport const q = sql`select sum(amount) from procurement.v_product_deliveries`;\n",
  ],
  ['rawsql-quoted', 'export const s = \'select * from "procurement"."bid_notices"\';\n'],
];

describe('조달 격리 규칙 (ESLint)', () => {
  const eslint = new ESLint({ cwd: ROOT });

  it('허용 목록 밖(features/chat·server/search)에서 import·동적 import·require·스키마 이름·스키마 객체·관계형 쿼리·raw SQL 을 막는다', async () => {
    for (const [name, source] of VIOLATIONS) {
      for (const dir of ['src/features/chat', 'src/server/search']) {
        const file = write(`${dir}/__procurement_${name}.tmp.ts`, source);
        const [result] = await eslint.lintFiles([file]);
        const messages = restricted(result);
        expect(messages.length, `${dir} ${name}`).toBeGreaterThanOrEqual(1);
        expect(
          messages.some((m) => m.message.includes('조달 모듈')),
          `${dir} ${name}`,
        ).toBe(true);
        rmSync(file, { force: true });
      }
    }
  }, 180_000);

  it('원가 허용 목록(features/costs)에서도 조달 모듈은 막힌다', async () => {
    const file = write('src/features/costs/__procurement_in_cost.tmp.ts', VIOLATIONS[0]![1]);
    const [result] = await eslint.lintFiles([file]);
    expect(restricted(result).some((m) => m.message.includes('조달 모듈'))).toBe(true);
  }, 60_000);

  it('조달 허용 목록 4곳은 통과 — 단 원가 모듈 제한은 그대로', async () => {
    const allowed = [
      'src/server/procurement/__allowed.tmp.ts',
      'src/features/procurement/__allowed.tmp.ts',
      'src/app/(app)/procurement/__allowed.tmp.ts',
      'src/app/(app)/admin/procurement/__allowed.tmp.ts',
    ];
    const source = [
      "import { sql } from 'drizzle-orm';",
      "import { procurementItems } from '@/db/schema';",
      "import { procurementBidNotices } from '@/db/schema/procurement';",
      "import { getBidNoticeRows } from '@/server/procurement/queries';",
      'export const keep = [procurementItems, procurementBidNotices, getBidNoticeRows];',
      'export const q = sql`select count(*) from procurement.deliveries`;',
      'export async function g() {',
      "  return (await import('@/server/procurement/queries')).getMonthlySeries;",
      '}',
      '',
    ].join('\n');
    for (const rel of allowed) {
      const file = write(rel, source);
      const [result] = await eslint.lintFiles([file]);
      expect(restricted(result), rel).toEqual([]);
    }
    const costInProcurement = write(
      'src/features/procurement/__cost.tmp.ts',
      "import { getCostRows } from '@/server/cost/queries';\nexport const keep = getCostRows;\n",
    );
    const [result] = await eslint.lintFiles([costInProcurement]);
    expect(restricted(result).some((m) => m.message.includes('server/cost'))).toBe(true);
  }, 120_000);

  it('권한 키·감사 키 문자열(procurement.read·procurement.item.add)은 raw SQL 로 오인하지 않는다', async () => {
    const file = write(
      'src/features/chat/__procurement_keys.tmp.ts',
      "export const keys = ['procurement.read', 'procurement.write', 'procurement.item.add', 'procurement.delivery.update'];\n",
    );
    const [result] = await eslint.lintFiles([file]);
    expect(restricted(result)).toEqual([]);
  }, 60_000);

  it('eslint 설정의 스키마 이름 목록이 procurement 스키마 export 를 모두 덮는다', () => {
    const config = readFileSync(path.join(ROOT, 'eslint.config.mjs'), 'utf8');
    const listed = /const PROCUREMENT_SCHEMA_EXPORTS = \[([\s\S]*?)\];/.exec(config)?.[1] ?? '';
    const names = new Set([...listed.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    for (const name of Object.keys(procurementSchemaModule)) {
      expect(names.has(name), name).toBe(true);
    }
    // 타입 export 도 목록에 있어야 한다 (런타임 키에는 없으므로 소스에서 읽는다)
    const dir = path.join(ROOT, 'src/db/schema/procurement');
    for (const entry of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, entry), 'utf8');
      for (const match of source.matchAll(/export type (\w+)/g)) {
        expect(names.has(match[1]!), match[1]).toBe(true);
      }
    }
  });

  it('소스 스캔: 허용 목록·src/db 밖 src 에 procurement 스키마·모듈 참조가 없다 (lint 우회 가드)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.includes('.tmp.')) continue;
        const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/');
        if (
          /^src\/(server\/procurement|features\/procurement|app\/\(app\)\/procurement|app\/\(app\)\/admin\/procurement|db)\//.test(
            rel,
          )
        )
          continue;
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        if (
          /\bprocurement[A-Z]\w*|(server|schema)\/procurement\b|procurement"?\s*\.\s*"?(items|deliveries|bid_notices|v_\w+)\b/.test(
            code,
          )
        )
          offenders.push(rel);
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
