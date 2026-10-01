// @vitest-environment node
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import writeXlsxFile, { type Cell } from 'write-excel-file/node';

import type { DbHandle } from '@/db';
import { withTransaction } from '@/db/tx';
import { uploadImport } from '@/server/imports/upload';
import {
  buildPartsDraft,
  draftSheets,
  loadDraftItems,
  modelTokens,
  specTokens,
  tokenMatches,
  type DraftItem,
} from '@/server/ops/parts-draft';

import { isInsideRepo, parsePartsDraftArgs } from '../../../scripts/parts-draft';
import { TEST_ACTOR, TEST_META, XLSX_MIME } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/**
 * PRAMI-003 §4.9.5 파츠 매핑 초안 (AC-336): 규칙 단위(T1/T2·대체카드 상속·근거 없음), 같은 대분류만, 결정성,
 * DB 변경 0(READ ONLY), 시트 1 이 `/admin/parts` 엑셀 등록 미리보기를 오류 0 으로 통과.
 * 원본 전체 실측 쌍 수와 Plan 참고값(935)과의 차이 이유는 PR 본문에 기록(수치 고정 아님).
 */
const item = (
  itemCode: string,
  itemName: string,
  itemKind: '본품' | '파츠',
  spec: string | null = null,
  extra: Partial<DraftItem> = {},
): DraftItem => ({
  itemCode,
  itemName,
  categoryMajor: 'WAPPLES',
  itemKind,
  itemStatus: '사용',
  spec,
  ...extra,
});

const ITEMS: DraftItem[] = [
  item('M1700T1', 'Wapples-1700 T1', '본품'),
  item('M1700T2', 'Wapples-1700 T2', '본품'),
  item('M2700', 'Wapples-2700 (H2700)', '본품'),
  item('M4700T1', 'Wapples-4700T1', '본품'),
  item('M4700T2', 'Wapples-4700 T2', '본품'),
  item('MOLD', 'Wapples-2700 단종', '본품', null, { itemStatus: '폐기' }),
  item('MNONE', 'Wapples Cloud', '본품'),
  item('MBIG', 'BA-POS Client (1,001~10,000 Terminal Unit)', '본품'),
  item('DAMO2700', 'SG-KMS-2700', '본품', null, { categoryMajor: 'D.AMO' }),
  item('P-NIC', 'N_51040 - 1G(U) 4포트', '파츠', '1700/2700/4700/5700/14000 전용'),
  item('P-MEM-T2', 'Memory DDR5 16GB', '파츠', '1700/2700/4700T2용'),
  item('P-MEM-T1', 'Memory DDR5 32GB', '파츠', '4700T1/5700/14000용'),
  item('P-REF', 'N_51244 - UTP용', '파츠', '2700/4600 전용'),
  item('P-ALT', 'N_51243 - 1G(UB)_(4port)', '파츠', 'N_51244 대체카드'),
  item('P-ALT-MISS', 'N_99999 - x', '파츠', 'N_00000 대체카드'),
  item('P-SSD', 'SSD 1TB', '파츠', null),
  item('P-LOG', 'HDD 2TB', '파츠', '로그 저장용 장치만 해당'),
  item('P-NOMODEL', 'N_9 - 40G', '파츠', '9999 전용'),
  item('P-DEAD', 'N_1 - 폐기', '파츠', '2700 전용', { itemStatus: '폐기' }),
];

const pairsOf = (code: string, draft = buildPartsDraft(ITEMS)) =>
  draft.pairs.filter((pair) => pair.partCode === code).map((pair) => pair.modelCode);

describe('토큰 규칙 (§4.9.5 ③·④)', () => {
  it('규격·모델 품명 토큰 추출 — 천 단위 쉼표 숫자는 플랫폼 번호가 아니다', () => {
    expect(specTokens('1700/2700/4700T2용')).toEqual([
      { number: '1700', tier: null },
      { number: '2700', tier: null },
      { number: '4700', tier: 'T2' },
    ]);
    expect(specTokens(null)).toEqual([]);
    expect(modelTokens('Wapples-1700 T1')).toEqual([{ number: '1700', tier: 'T1' }]);
    expect(modelTokens('Wapples-4700T1')).toEqual([{ number: '4700', tier: 'T1' }]);
    expect(modelTokens('Wapples-2700 (H2700)')).toHaveLength(2);
    expect(modelTokens('BA-POS Client (1,001~10,000 Terminal Unit)')).toEqual([]);
  });

  it('T 표기: 규격에 T 가 있으면 모델 T 까지 같아야, 없으면 T1·T2·표기 없음 모두', () => {
    expect(tokenMatches({ number: '1700', tier: null }, { number: '1700', tier: 'T1' })).toBe(true);
    expect(tokenMatches({ number: '4700', tier: 'T2' }, { number: '4700', tier: 'T2' })).toBe(true);
    expect(tokenMatches({ number: '4700', tier: 'T2' }, { number: '4700', tier: 'T1' })).toBe(
      false,
    );
    expect(tokenMatches({ number: '4700', tier: 'T2' }, { number: '4700', tier: null })).toBe(
      false,
    );
    expect(tokenMatches({ number: '2700', tier: null }, { number: '2600', tier: null })).toBe(
      false,
    );
  });
});

describe('buildPartsDraft (AC-336 ③④)', () => {
  it('T 없는 규격 토큰은 T1·T2 모델 모두와 연결', () => {
    expect(pairsOf('P-NIC')).toEqual(['M1700T1', 'M1700T2', 'M2700', 'M4700T1', 'M4700T2']);
  });

  it('4700T2 토큰은 4700 T2 모델만, 1700·2700(T 없음)은 T1·T2 모두', () => {
    expect(pairsOf('P-MEM-T2')).toEqual(['M1700T1', 'M1700T2', 'M2700', 'M4700T2']);
    expect(pairsOf('P-MEM-T1')).toEqual(['M4700T1']);
  });

  it('대체카드는 참조 파츠(품명 첫 단어)의 규격을 이어받는다', () => {
    expect(pairsOf('P-ALT')).toEqual(['M2700']);
    const draft = buildPartsDraft(ITEMS);
    expect(draft.pairs.find((pair) => pair.partCode === 'P-ALT')?.rule).toBe(
      '대체카드 상속(N_51244) · 규격 토큰 2700',
    );
  });

  it('근거 없음: 토큰 없음·참조 없음·일치 모델 없음 — 사유와 함께, 쌍은 만들지 않는다', () => {
    const draft = buildPartsDraft(ITEMS);
    expect(draft.noEvidence.map((entry) => [entry.partCode, entry.reason])).toEqual([
      ['P-ALT-MISS', '대체카드 참조 없음'],
      ['P-LOG', '규격 토큰 없음'],
      ['P-NOMODEL', '일치 모델 없음'],
      ['P-SSD', '규격 토큰 없음'],
    ]);
    for (const code of ['P-SSD', 'P-LOG', 'P-ALT-MISS', 'P-NOMODEL'])
      expect(pairsOf(code)).toEqual([]);
  });

  it('같은 대분류만, 둘 다 사용 상태, 모델 본품·파츠 파츠 — 폐기·토큰 없는 모델·다른 대분류 제외', () => {
    const draft = buildPartsDraft(ITEMS);
    const codes = new Set(draft.pairs.flatMap((pair) => [pair.modelCode, pair.partCode]));
    for (const excluded of ['MOLD', 'MNONE', 'MBIG', 'DAMO2700', 'P-DEAD'])
      expect(codes.has(excluded)).toBe(false);
    expect(draft.pairs.every((pair) => pair.major === 'WAPPLES')).toBe(true);
    expect(draft.perMajor).toEqual({ WAPPLES: draft.pairs.length });
  });

  it('결정적: 입력 순서가 달라도 같은 결과 (AC-336 ⑤)', () => {
    expect(buildPartsDraft([...ITEMS].reverse())).toEqual(buildPartsDraft(ITEMS));
  });

  it('시트 3개: 시트 1 은 모델품번·파츠품번 2컬럼', () => {
    const sheets = draftSheets(buildPartsDraft(ITEMS));
    expect(sheets.mapping[0]).toEqual(['모델품번', '파츠품번']);
    expect(sheets.mapping.every((row) => row.length === 2)).toBe(true);
    expect(sheets.review[0]).toHaveLength(7);
    expect(sheets.noEvidence[0]).toEqual([
      '대분류',
      '파츠 품번',
      '파츠 품명',
      '파츠 규격 원문',
      '사유',
    ]);
  });
});

describe('DB 에서 초안 → /admin/parts 엑셀 미리보기 (AC-336 ①②)', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
    await handle.db.execute(
      sql`insert into import_batches (id, kind, file_name, file_sha256, file_size, status)
          values ('00000000-0000-4000-8000-0000000000aa', 'item_master', 't.xlsx', 'x', 1, 'applied')`,
    );
    for (const entry of ITEMS) {
      await handle.db.execute(
        sql`insert into items (item_code, item_name, category_major, item_kind, item_status, source, raw, import_batch_id)
            values (${entry.itemCode}, ${entry.itemName}, ${entry.categoryMajor}, ${entry.itemKind}, ${entry.itemStatus},
                    'master', ${JSON.stringify(entry.spec ? { 규격: entry.spec } : {})}::jsonb, '00000000-0000-4000-8000-0000000000aa')`,
      );
    }
  });

  afterAll(async () => {
    await handle.close();
  });

  it('READ ONLY 트랜잭션에서 읽고(DB 변경 0) 시트 1 업로드 미리보기 오류 0', async () => {
    const before = await handle.db.execute(sql`select count(*)::int as n from part_mappings`);
    const items = await withTransaction((tx) => loadDraftItems(tx), handle, {
      accessMode: 'read only',
    });
    expect(items).toHaveLength(ITEMS.length);
    const draft = buildPartsDraft(items);
    expect(draft).toEqual(buildPartsDraft(ITEMS));
    const sheets = draftSheets(draft);
    const bytes = await writeXlsxFile([
      { data: sheets.mapping.map((row) => row.map((v) => v as Cell)), sheet: '매핑 등록' },
      { data: sheets.review.map((row) => row.map((v) => v as Cell)), sheet: '검수' },
      { data: sheets.noEvidence.map((row) => row.map((v) => v as Cell)), sheet: '근거 없음' },
    ]).toBuffer();
    const upload = await uploadImport(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      { kind: 'parts', fileName: 'parts-draft.xlsx', mimeType: XLSX_MIME, bytes },
    );
    expect(upload.errors).toEqual([]);
    expect(upload.errorCount).toBe(0);
    expect(upload.rowCount).toBe(draft.pairs.length);
    const after = await handle.db.execute(sql`select count(*)::int as n from part_mappings`);
    expect(after).toEqual(before);
  });
});

describe('CLI 인자', () => {
  it('--out 필수, 저장소 안 경로는 거부 대상', () => {
    expect(() => parsePartsDraftArgs([])).toThrowError(/--out/);
    expect(parsePartsDraftArgs(['--out', 'x']).out).toBe(path.resolve('x'));
    expect(isInsideRepo(path.join(process.cwd(), 'tmp'))).toBe(true);
    expect(isInsideRepo(process.cwd())).toBe(true);
    expect(isInsideRepo(path.resolve(process.cwd(), '..', 'outside'))).toBe(false);
  });
});
