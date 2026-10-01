// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { applyPolicy } from '@/server/imports/apply-policy';
import { checkInvariants } from '@/server/imports/invariants';
import { uploadItemFiles } from '@/server/imports/item-upload';
import { readWorkbook } from '@/server/imports/parse-xlsx';
import { ITEM_HEADER_TREATMENTS } from '@/server/imports/schemas/items';
import { queryRows } from '@/server/imports/sql-rows';
import type { UploadResult } from '@/server/imports/upload';
import { listPartsCatalog } from '@/server/parts/catalog';
import { getCategoryOptions } from '@/server/pricing/categories';
import { listQuoteBundles, listQuoteParts } from '@/server/quotes/catalog';
import { previewItemMerge } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture, XLSX_MIME } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/**
 * PRAMI-003 AC-303·AC-309~AC-312 — 실데이터 고정값 (원본은 저장소에 없다).
 * `PRAMI_INPUTS_DIR`(기본: 로컬 _inputs) 아래 `PRAMI-003/` 품목 5파일 + `PRAMI-001/병합_가격_raw.xlsx` 가 있을 때만 실행한다.
 * 개인 이름은 테스트 실행 중 원본에서 읽어 메모리에서만 비교한다(코드·스냅샷·실패 메시지에 쓰지 않는다).
 */
const INPUTS = process.env.PRAMI_INPUTS_DIR ?? 'C:/Users/USER/orca/workspaces/Prami/_inputs';
const ITEM_DIR = path.join(INPUTS, 'PRAMI-003');
const SALES = path.join(INPUTS, 'PRAMI-001', '병합_가격_raw.xlsx');
const available = existsSync(ITEM_DIR) && existsSync(SALES);
const PERSONAL_HEADERS = ['등록자', '최종수정자', '관리자'];
const HEADER_LABELS = new Set<string>(ITEM_HEADER_TREATMENTS.map(([header]) => header));

function itemFiles() {
  return readdirSync(ITEM_DIR)
    .filter((name) => name.endsWith('.xlsx'))
    .sort()
    .map((name) => ({
      fileName: name,
      mimeType: XLSX_MIME,
      bytes: readFileSync(path.join(ITEM_DIR, name)),
    }));
}

/** 원본 개인정보 열의 고유값 (메모리 전용) */
async function personalNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const file of itemFiles()) {
    const sheet = (await readWorkbook(file.bytes))[0]!;
    const header = (sheet.rows[1] ?? []).map((cell) => String(cell ?? '').trim());
    const columns = PERSONAL_HEADERS.map((name) => header.indexOf(name)).filter((i) => i >= 0);
    for (const row of sheet.rows.slice(2)) {
      for (const column of columns) {
        const value = String(row[column] ?? '').trim();
        // 헤더 라벨과 같은 값(예: 셀에 '관리자' 문자열)은 사람 이름이 아니라 헤더 문구라 제외한다
        if (value && !HEADER_LABELS.has(value)) names.add(value);
      }
    }
  }
  return [...names];
}

/** 이름이 텍스트에 몇 개 나오는지 — 실패해도 이름 자체는 출력하지 않는다 */
function countNamesIn(text: string, names: readonly string[]): number {
  return names.filter((name) => text.includes(name)).length;
}

async function dumpAllTables(handle: DbHandle): Promise<string> {
  const tables = await queryRows<{ name: string }>(
    handle.db,
    sql`select table_name as name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const parts: string[] = [];
  for (const { name } of tables) {
    const rows = await queryRows<{ t: string }>(
      handle.db,
      sql.raw(`select row_to_json(x)::text as t from "${name}" x`),
    );
    parts.push(...rows.map((row) => row.t));
  }
  return parts.join('\n');
}

describe.skipIf(!available)('품목 마스터 실데이터 (PRAMI-003 AC-303·AC-309~312)', () => {
  let handle: DbHandle;
  let itemUpload: UploadResult;
  let applyJson = '';
  const logs: string[] = [];

  beforeAll(async () => {
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(
          args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
        );
      });
    }
    handle = await createTestDb();
    const sales = await uploadFixture(handle, 'sales', '병합_가격_raw.xlsx', readFileSync(SALES));
    expect(sales).toMatchObject({ status: 'parsed', rowCount: 5885, errorCount: 0 });
    itemUpload = await uploadItemFiles({ handle, actor: TEST_ACTOR, meta: TEST_META }, itemFiles());
    const result = await applyPolicy(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      {
        salesBatchId: sales.batchId,
        itemBatchId: itemUpload.batchId,
        salesReused: false,
        itemReused: false,
      },
    );
    applyJson = JSON.stringify(result);
  }, 240_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await handle?.close();
  });

  it('AC-304·AC-301 업로드: 배치 1개, 5파일 source_files, 2,511행, 헤더 경고·오류 0, 개인정보 컬럼 3개 제외 정보', () => {
    expect(itemUpload).toMatchObject({ status: 'parsed', rowCount: 2511, errorCount: 0 });
    expect(itemUpload.sourceFiles).toHaveLength(5);
    expect(itemUpload.sourceFiles!.reduce((sum, file) => sum + file.rowCount, 0)).toBe(2511);
    const codes = itemUpload.warnings.map((warning) => warning.code);
    expect(codes).not.toContain('missing_header');
    expect(codes).not.toContain('extra_header');
    expect(codes).not.toContain('mixed_major_in_file');
    expect(codes).not.toContain('sales_items_not_covered');
    expect(itemUpload.warnings.find((w) => w.code === 'excluded_columns_dropped')?.value).toBe(3);
  });

  it('AC-310 상태 분포 (전체 / 판매단가 커버)', async () => {
    const all = await queryRows<{ s: string; n: number }>(
      handle.db,
      sql`select item_status::text as s, count(*)::int as n from items where source = 'master' group by 1`,
    );
    expect(Object.fromEntries(all.map((r) => [r.s, r.n]))).toEqual({
      사용: 856,
      폐기: 1609,
      임시: 46,
    });
    const covered = await queryRows<{ s: string; n: number }>(
      handle.db,
      sql`select item_status::text as s, count(*)::int as n from items i
          where exists (select 1 from sales_prices sp where sp.item_code = i.item_code and sp.deleted_at is null)
          group by 1`,
    );
    expect(Object.fromEntries(covered.map((r) => [r.s, r.n]))).toEqual({
      사용: 663,
      폐기: 803,
      임시: 29,
    });
    const [nulls] = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from items where source = 'master' and item_status is null`,
    );
    expect(nulls!.n).toBe(0);
  });

  it('AC-311 정책 재검증: 계열 3,810 · 운영중 2,428 · 미사용 3,457 · I-1/I-2 0 · stub 0', async () => {
    const [row] = await queryRows<Record<string, number>>(
      handle.db,
      sql`select count(distinct series_key)::int as series,
            count(*) filter (where operation_status = '운영중')::int as operating,
            count(*) filter (where operation_status = '미사용')::int as unused,
            count(*) filter (where not is_latest_in_series)::int as not_latest,
            count(*) filter (where is_latest_in_series and i.item_status = '폐기')::int as latest_discarded,
            count(*) filter (where is_latest_in_series and i.item_status = '사용')::int as latest_in_use,
            count(*) filter (where is_latest_in_series and i.item_status = '임시')::int as latest_temp
          from sales_prices sp left join items i on i.item_code = sp.item_code
          where sp.deleted_at is null`,
    );
    expect(row).toEqual({
      series: 3810,
      operating: 2428,
      unused: 3457,
      not_latest: 2075,
      latest_discarded: 1382,
      latest_in_use: 2310,
      latest_temp: 118,
    });
    const invariants = await checkInvariants(handle.db);
    expect(invariants).toEqual({ i1: 0, i2: 0 });
    const [stub] = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from items where source = 'stub'`,
    );
    expect(stub!.n).toBe(0);
  });

  it('AC-307 정규화: 대분류 원문·정규화 집합과 행 수, I-10 위반 0', async () => {
    const rows = await queryRows<{ major: string; raw: string; n: number }>(
      handle.db,
      sql`select category_major as major, category_major_raw as raw, count(*)::int as n
          from items where source = 'master' group by 1, 2`,
    );
    expect([...rows].sort((a, b) => a.major.localeCompare(b.major, 'en'))).toEqual([
      { major: 'Cloudbric', raw: 'Cloudbric', n: 156 },
      { major: 'D.AMO', raw: "D'Amo", n: 1335 },
      { major: 'iSIGN', raw: 'iSIGN+', n: 420 },
      { major: 'iSIGN PKI', raw: 'iSIGN+ PKI', n: 215 },
      { major: 'WAPPLES', raw: 'WAPPLES', n: 385 },
    ]);
    expect(JSON.parse(applyJson).stats).toMatchObject({ i10Violations: 0, overrideUnknown: [] });
  });

  it('AC-312 판정 분포 (커버·전체·제품군별·규칙)', async () => {
    const tally = async (where: ReturnType<typeof sql>) =>
      Object.fromEntries(
        (
          await queryRows<{ k: string; n: number }>(
            handle.db,
            sql`select item_kind::text as k, count(*)::int as n from items i where source = 'master' ${where} group by 1`,
          )
        ).map((r) => [r.k, r.n]),
      );
    const covered = sql`and exists (select 1 from sales_prices sp where sp.item_code = i.item_code and sp.deleted_at is null)`;
    expect(await tally(covered)).toEqual({
      본품: 1335,
      파츠: 84,
      서비스: 38,
      결합형: 24,
      기타: 14,
    });
    expect(await tally(sql``)).toEqual({
      본품: 2203,
      파츠: 121,
      서비스: 108,
      결합형: 63,
      기타: 16,
    });
    const byFamily: Record<string, Record<string, number>> = {
      WAPPLES: { 본품: 192, 파츠: 58, 서비스: 13 },
      'D.AMO': { 본품: 619, 파츠: 18, 서비스: 16, 결합형: 24, 기타: 14 },
      iSIGN: { 본품: 338, 파츠: 8, 서비스: 5 },
      'iSIGN PKI': { 본품: 109, 서비스: 2 },
      Cloudbric: { 본품: 77, 서비스: 2 },
    };
    for (const [family, expected] of Object.entries(byFamily)) {
      expect(await tally(sql`${covered} and i.category_major = ${family}`)).toEqual(expected);
    }
    const rules = await queryRows<{ r: string; n: number }>(
      handle.db,
      sql`select item_kind_rule as r, count(*)::int as n from items i where source = 'master' ${covered} group by 1`,
    );
    expect(Object.fromEntries(rules.map((r) => [r.r, r.n]))).toEqual({
      K0: 12,
      K1: 41,
      K2: 37,
      K3: 6,
      K4: 28,
      K5: 24,
      K6: 14,
      K7: 1333,
    });
  });

  it('AC-309 드롭다운 옵션: 대분류 5 · 중분류 12/19/10/9/3 · (중,소) 조합 142', async () => {
    const top = await getCategoryOptions(handle.db, {});
    expect(top.majors).toEqual(['WAPPLES', 'D.AMO', 'iSIGN', 'iSIGN PKI', 'Cloudbric']);
    const midCounts: Record<string, number> = {};
    let combos = 0;
    for (const major of top.majors) {
      const { mids } = await getCategoryOptions(handle.db, { major });
      midCounts[major] = mids.length;
      for (const mid of mids)
        combos += (await getCategoryOptions(handle.db, { major, mid })).minors.length;
    }
    expect(midCounts).toEqual({
      WAPPLES: 12,
      'D.AMO': 19,
      iSIGN: 10,
      'iSIGN PKI': 9,
      Cloudbric: 3,
    });
    expect(combos).toBe(142);
    const cloudbric = await getCategoryOptions(handle.db, { major: 'Cloudbric' });
    expect(cloudbric.mids).not.toContain('Cloudbric Managed Service');
  }, 300_000);

  it('AC-314 화면 영향: 파츠 관리 WAPPLES 모델 192·파츠 58, 계산기 STEP4(정상판매) WAPPLES 43 · iSIGN PKI 0, STEP5 D.AMO 결합형 후보 24 중 정상판매 운영중 3', async () => {
    const parts = await listPartsCatalog(handle.db, 'WAPPLES');
    expect([parts.models.length, parts.parts.length]).toEqual([192, 58]);
    const step4 = (family: string) =>
      listQuoteParts(handle.db, { family, priceType: '정상판매', modelItemCode: 'P-NO-MAPPING' });
    expect((await step4('WAPPLES')).parts).toHaveLength(43);
    expect((await step4('iSIGN PKI')).parts).toHaveLength(0);
    const [bundles] = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from items i where source = 'master' and item_kind = '결합형'
          and category_major = 'D.AMO'
          and exists (select 1 from sales_prices sp where sp.item_code = i.item_code and sp.deleted_at is null)`,
    );
    expect(bundles!.n).toBe(24);
    expect(
      await listQuoteBundles(handle.db, { family: 'D.AMO', priceType: '정상판매' }),
    ).toHaveLength(3);
  });

  it('AC-303 개인정보: DB 전 테이블 덤프·업로드/적용 응답·로그에 원본 개인 이름 0건', async () => {
    const names = await personalNames();
    expect(names.length).toBeGreaterThan(0);
    expect(countNamesIn(await dumpAllTables(handle), names)).toBe(0);
    expect(countNamesIn(JSON.stringify(itemUpload), names)).toBe(0);
    expect(countNamesIn(applyJson, names)).toBe(0);
    expect(countNamesIn(logs.join('\n'), names)).toBe(0);
  });

  // 마지막: 배치를 바꾸는 시나리오 (앞 테스트의 고정값에 영향 없게)
  it('AC-306 실데이터: WAPPLES 파일만 업로드 → missing_families 4개, 전량 교체 시 사라질 품번 2,126', async () => {
    const wapples = itemFiles().filter((file) => file.fileName.startsWith('WAPPLES'));
    const upload = await uploadItemFiles({ handle, actor: TEST_ACTOR, meta: TEST_META }, wapples);
    expect(upload.itemMerge).toEqual({
      missingFamilies: ['Cloudbric', 'D.AMO', 'iSIGN', 'iSIGN PKI'],
      vanishingItems: 2126,
    });
    const preview = await previewItemMerge(handle, upload.batchId);
    expect(preview.vanishingItems).toBe(2126);
    // AC-373 ③ (PR #19 QA I-3 실측: 전량 교체 후 운영중 2,428 → 3,644)
    expect(preview.operating).toEqual({ now: 2428, afterReplace: 3644 });
  });
});
