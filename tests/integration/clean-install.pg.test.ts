import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pg from 'pg';
import readXlsxFile from 'read-excel-file/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import writeXlsxFile, { type Cell } from 'write-excel-file/node';

import type { DataBaseline } from '@/server/ops/data-baseline';

/**
 * AC-331 클린 설치 (PRAMI-003 §4.9.1·§4.9.2) — 실제 PostgreSQL 16 에 **빈 DB** 를 새로 만들고 정식 경로만으로 적재한다:
 * `db:migrate` → `import:source` 판매단가 → 품목 → 원가 → `data:verify --fresh --target local` exit 0. seed 는 호출하지 않는다.
 * ① 축소 픽스처(CI): 판매단가 200행 표본 중 품목 픽스처가 덮는 품번만 + items-v1 + costs-dup, 기준값 파일은 픽스처 해시·행 수
 * ② 원본 전체(`PRAMI_INPUTS_DIR` 있을 때 — 로컬·QA): r3 기준값(src/server/ops/data-baseline.ts) 그대로 exit 0
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);
const inputsDir = process.env.PRAMI_INPUTS_DIR;
const ROOT = path.resolve(import.meta.dirname, '../..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const FIXTURES = path.join(ROOT, 'tests/fixtures/imports');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function dbUrl(name: string): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: dbUrl('postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function run(script: string, args: string[], url: string) {
  const env = { ...process.env, DB_DRIVER: 'pg', DATABASE_URL: url } as NodeJS.ProcessEnv;
  delete env.PRAMI_ALLOW_SEED;
  const result = spawnSync(
    process.execPath,
    [TSX_CLI, '--conditions=react-server', path.join('scripts', script), ...args],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 180_000 },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function count(url: string, query: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>(query);
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

describe.skipIf(!enabled)(
  '클린 설치 — 빈 DB → migrate → 정식 임포트 → data:verify (AC-331)',
  { timeout: 600_000 },
  () => {
    const databases: string[] = [];
    const temps: string[] = [];

    async function freshDatabase(): Promise<string> {
      const name = `prami_clean_${randomBytes(4).toString('hex')}`;
      await admin((client) => client.query(`create database ${name}`));
      databases.push(name);
      return dbUrl(name);
    }

    afterAll(async () => {
      for (const name of databases) {
        await admin((client) => client.query(`drop database if exists ${name} with (force)`));
      }
      for (const dir of temps) rmSync(dir, { recursive: true, force: true });
    });

    describe('① 축소 픽스처', () => {
      let url: string;
      let work: string;
      let salesFile: string;
      let salesRows: number;

      beforeAll(async () => {
        work = mkdtempSync(path.join(tmpdir(), 'prami-clean-'));
        temps.push(work);
        // 품목 픽스처(items-v1)가 덮는 품번의 판매단가만 남긴다 → 적용 후 stub 0 (클린 설치 모양)
        const [itemSheet] = await readXlsxFile(readFileSync(path.join(FIXTURES, 'items-v1.xlsx')));
        const [itemTitle, itemHeader, ...itemRows] = itemSheet!.data;
        void itemTitle;
        const codeIndex = (itemHeader as unknown[]).indexOf('품번');
        const codes = new Set(itemRows.map((row) => String(row[codeIndex])));
        const [salesSheet] = await readXlsxFile(
          readFileSync(path.join(FIXTURES, 'sales-200.xlsx')),
        );
        const [salesHeader, ...rows] = salesSheet!.data;
        const kept = rows.filter((row) => codes.has(String(row[2])));
        salesRows = kept.length;
        salesFile = path.join(work, 'sales-clean.xlsx');
        await writeXlsxFile(
          [salesHeader!, ...kept].map((row) => row.map((v) => v as Cell)),
          {
            sheet: 'RAW',
          },
        ).toFile(salesFile);
        url = await freshDatabase();
      });

      it('S-1 빈 DB(public 테이블 0) → S-2 migrate → data:verify --stage schema exit 0', async () => {
        expect(
          await count(
            url,
            "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
          ),
        ).toBe(0);
        expect(run('migrate.ts', [], url).status).toBe(0);
        const schema = run('data-verify.ts', ['--stage', 'schema'], url);
        expect(schema.status).toBe(0);
        expect(schema.output).toMatch(/__drizzle_migrations 행 \| 10 \| 10 \| PASS/);
      });

      it('S-4~S-6 판매단가 → 품목 → 원가 (정식 서비스 경로, 감사 actor script:<OS 사용자>)', async () => {
        expect(run('import-source.ts', [salesFile, '--kind', 'sales'], url).status).toBe(0);
        expect(
          run('import-source.ts', [path.join(FIXTURES, 'items-v1.xlsx'), '--kind', 'items'], url)
            .status,
        ).toBe(0);
        expect(
          run('import-source.ts', [path.join(FIXTURES, 'costs-dup.xlsx'), '--kind', 'costs'], url)
            .status,
        ).toBe(0);
        expect(
          await count(
            url,
            "select count(*)::int as n from audit_logs where actor_label like 'script:%'",
          ),
        ).toBeGreaterThan(0);
      });

      it('S-7 data:verify --fresh --target local (픽스처 기준값) exit 0, seed 흔적 0', async () => {
        const salesBytes = readFileSync(salesFile);
        const itemBytes = readFileSync(path.join(FIXTURES, 'items-v1.xlsx'));
        const costBytes = readFileSync(path.join(FIXTURES, 'costs-dup.xlsx'));
        const [costSheet] = await readXlsxFile(costBytes);
        const itemCount = (await readXlsxFile(itemBytes))[0]!.data.length - 2;
        const dist = async (column: string) => {
          const client = new pg.Client({ connectionString: url });
          await client.connect();
          try {
            const { rows } = await client.query<{ k: string; n: number }>(
              `select ${column}::text as k, count(*)::int as n from items group by 1`,
            );
            return Object.fromEntries(rows.map((row) => [row.k, row.n]));
          } finally {
            await client.end();
          }
        };
        const baseline: DataBaseline = {
          sources: {
            sales: sha256(salesBytes),
            costs: sha256(costBytes),
            items: [sha256(itemBytes)],
          },
          expected: {
            migrations: 10,
            // 파일에서 독립적으로 센 값
            items: itemCount,
            salesRows,
            costRows: costSheet!.data.length - 2,
            // 판정 결과 분포·운영상태는 적용 결과 실측 (불변식·시연 데이터 0 검사는 별도로 판정)
            itemStatus: await dist('item_status'),
            itemMajor: await dist('category_major'),
            itemKind: await dist('item_kind'),
            salesSeries: await count(
              url,
              'select count(distinct series_key)::int as n from sales_prices',
            ),
            salesLatest: await count(
              url,
              'select count(*)::int as n from sales_prices where is_latest_in_series',
            ),
            operating: await count(
              url,
              "select count(*)::int as n from sales_prices where operation_status = '운영중'",
            ),
            unused: await count(
              url,
              "select count(*)::int as n from sales_prices where operation_status = '미사용'",
            ),
          },
        };
        const baselineFile = path.join(work, 'baseline.json');
        writeFileSync(baselineFile, JSON.stringify(baseline));

        const verify = run(
          'data-verify.ts',
          ['--fresh', '--target', 'local', '--baseline', baselineFile],
          url,
        );
        expect(verify.output).not.toMatch(/\| FAIL \|/);
        expect(verify.status).toBe(0);
        expect(verify.output).toMatch(/품목 stub \| 0 \| 0 \| PASS/);
        expect(verify.output).not.toMatch(/@/);
        expect(await count(url, 'select count(*)::int as n from users')).toBe(0);
        expect(
          await count(url, "select count(*)::int as n from audit_logs where actor_label = 'seed'"),
        ).toBe(0);

        // r3 원본 기준값으로 돌리면 해시가 달라 exit 2 (실측 출력)
        const real = run('data-verify.ts', ['--fresh'], url);
        expect(real.status).toBe(2);
        expect(real.output).toMatch(/원본이 바뀌었음/);
      });
    });

    describe.skipIf(!inputsDir)('② 원본 전체 (PRAMI_INPUTS_DIR)', () => {
      it('§4.9.2 표 기대값 전부 일치 — items 2,511·stub 0·운영중 2,428·미사용 3,457·원가 487·I-1/I-2/I-10 0', async () => {
        const url = await freshDatabase();
        const file = (...parts: string[]) => path.join(inputsDir!, ...parts);
        expect(run('migrate.ts', [], url).status).toBe(0);
        expect(
          run('import-source.ts', [file('PRAMI-001', '병합_가격_raw.xlsx'), '--kind', 'sales'], url)
            .status,
        ).toBe(0);
        const items = [
          'WAPPLES 품목.xlsx',
          "D'AMO 품목.xlsx",
          'iSIGN 품목.xlsx',
          'iSGIN PKI 품목.xlsx',
          'cloudbric 품목.xlsx',
        ];
        expect(
          run(
            'import-source.ts',
            [...items.map((name) => file('PRAMI-003', name)), '--kind', 'items'],
            url,
          ).status,
        ).toBe(0);
        expect(
          run(
            'import-source.ts',
            [file('PRAMI-001', '원자재코드 정보_260825.xlsx'), '--kind', 'costs'],
            url,
          ).status,
        ).toBe(0);
        const verify = run('data-verify.ts', ['--fresh', '--target', 'local'], url);
        expect(verify.output).not.toMatch(/\| (FAIL|MEASURED) \|/);
        expect(verify.status).toBe(0);
        expect(verify.output).toMatch(/운영중 \| 2428 \| 2428 \| PASS/);
      });
    });
  },
);
