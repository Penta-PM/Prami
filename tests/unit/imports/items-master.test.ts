// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyItemKind,
  ITEM_KIND_OVERRIDES,
  type ItemKindInput,
} from '@/lib/constants/item-kind-rules';
import { ITEM_STATUS_MAP, mapItemStatus } from '@/lib/constants/item-status';
import { PRODUCT_CARDS } from '@/lib/constants/product-cards';
import {
  ERP_MAJOR_TO_FAMILY,
  NORMALIZED_FAMILIES,
  normalizeErpMajor,
} from '@/lib/constants/product-family';
import { parseSheet } from '@/server/imports/parse-sheet';
import { readWorkbook } from '@/server/imports/parse-xlsx';
import {
  ITEM_EXCLUDED_HEADERS,
  ITEM_HEADER_TREATMENTS,
  ITEM_RAW_HEADERS,
  ITEM_REQUIRED_HEADERS,
  ITEM_SPEC,
} from '@/server/imports/schemas/items';

import { cellOf, itemXlsx, readItemFixture, withCell } from '../../helpers/items';

/** PRAMI-003 §4.2.1·§4.2.4·§4.2.6·§4.2.7 순수 규칙 + 축소 픽스처 파싱 (CI 실행) */
const parseBuffer = async (bytes: Buffer) => parseSheet(ITEM_SPEC, await readWorkbook(bytes));

describe('AC-301 헤더 상수 (39컬럼 원문 스냅샷)', () => {
  it('헤더 39개 원문·순서와 처리 구분 (정규 9 · raw 27 · 제외 3), 필수 6', () => {
    expect(ITEM_HEADER_TREATMENTS.map(([header]) => header)).toEqual([
      '품명',
      '품번',
      '규격',
      '품목자산분류',
      '기준단위',
      '품목 상태',
      '내외자구분',
      '중요도',
      '부서',
      '관리자',
      '품목대분류',
      '품목중분류',
      '품목소분류',
      '품목약명',
      '영문명',
      '영문약명',
      '옵션품목',
      '세트품목',
      '모델상속',
      '모델명',
      '대표품명',
      'BOM등록',
      '제품별공정소요자재',
      'LOT관리',
      'Serial관리',
      '등록일',
      '등록자',
      '최종수정일',
      '최종수정자',
      '비고',
      '구매거래처',
      '부가세구분',
      '판매단가등록여부',
      '판매단가에부가세포함',
      '파일첨부여부',
      '소요량 계산방식',
      '불출구분',
      '생산유형구분',
      '생산사양',
    ]);
    expect(ITEM_EXCLUDED_HEADERS).toEqual(['관리자', '등록자', '최종수정자']);
    expect(ITEM_RAW_HEADERS).toHaveLength(27);
    expect(ITEM_REQUIRED_HEADERS).toEqual([
      '품명',
      '품번',
      '품목 상태',
      '품목대분류',
      '품목중분류',
      '품목소분류',
    ]);
  });
});

describe('AC-307 대분류 대응표 · AC-310 상태 매핑', () => {
  it('ERP 원문 → 정규화 제품군 (정확 일치·trim), 미지 대분류 null, 정규화 값 = 홈 카드 대분류', () => {
    expect(ERP_MAJOR_TO_FAMILY).toEqual({
      WAPPLES: 'WAPPLES',
      "D'Amo": 'D.AMO',
      'iSIGN+': 'iSIGN',
      'iSIGN+ PKI': 'iSIGN PKI',
      Cloudbric: 'Cloudbric',
    });
    expect(normalizeErpMajor(" D'Amo ")).toBe('D.AMO');
    expect(normalizeErpMajor('D-Amo')).toBeNull();
    expect(normalizeErpMajor('isign+')).toBeNull();
    const cardMajors = PRODUCT_CARDS.flatMap((card) => card.majors ?? [card.major]);
    expect([...NORMALIZED_FAMILIES].sort()).toEqual([...cardMajors].sort());
  });

  it('ITEM_STATUS_MAP 확정 (임시·폐기·사용), 그 외 null', () => {
    expect(ITEM_STATUS_MAP).toEqual({ 임시: '임시', 폐기: '폐기', 사용: '사용' });
    expect(mapItemStatus(' 폐기 ')).toBe('폐기');
    expect(mapItemStatus('보류')).toBeNull();
  });
});

describe('AC-312·AC-313 판정 규칙표 K0~K7', () => {
  const kind = (input: Partial<ItemKindInput>) =>
    classifyItemKind({ itemCode: 'P9999', major: 'WAPPLES', mid: null, minor: null, ...input });

  it.each([
    [{ mid: 'Parts', minor: 'NIC' }, '파츠', 'K1'],
    [{ mid: 'Wapples Product', minor: 'NIC' }, '파츠', 'K2'],
    [{ mid: 'X', minor: 'SSL/TLS Acceleator Options' }, '파츠', 'K2'],
    [{ mid: 'Wapples Product', minor: '기타' }, '파츠', 'K3'],
    [{ major: "D'Amo", mid: 'Wapples Product', minor: '기타' }, '본품', 'K7'],
    [{ mid: '유지보수', minor: 'X' }, '서비스', 'K4'],
    [{ mid: 'X', minor: 'Install Fee' }, '서비스', 'K4'],
    [{ mid: 'X', minor: 'SA 유지보수' }, '서비스', 'K4'],
    [{ mid: '번들용 패키지', minor: 'X' }, '결합형', 'K5'],
    [{ mid: 'X', minor: 'SG-KMS(Optional Package)' }, '결합형', 'K5'],
    [{ mid: 'X', minor: '타사제품' }, '기타', 'K6'],
    [{ mid: 'Wapples Product', minor: 'H-Series' }, '본품', 'K7'],
  ])('%j → %s (%s)', (input, expectedKind, rule) => {
    expect(kind(input)).toEqual({ kind: expectedKind, rule });
  });

  it('K0 예외표 12건이 표의 종류로 판정 (Parts/NIC 로 분류된 PKI Agent 는 본품)', () => {
    expect(Object.keys(ITEM_KIND_OVERRIDES)).toHaveLength(12);
    for (const [itemCode, expected] of Object.entries(ITEM_KIND_OVERRIDES)) {
      expect(kind({ itemCode, mid: 'Parts', minor: 'NIC' })).toEqual({
        kind: expected,
        rule: 'K0',
      });
    }
    expect(kind({ itemCode: 'P40460013', major: 'iSIGN+', mid: 'Parts', minor: 'NIC' }).kind).toBe(
      '본품',
    );
  });

  it('AC-313 품명 fallback 제거: 저장소(src)에 품명 정규식 판정 심볼·SQL 분기가 없다', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(path.resolve(process.cwd(), 'src'));
    const banned =
      /PART_NAME_PATTERN|SERVICE_NAME_PATTERN|classifyItemName|PART_NAME_REGEX|SERVICE_NAME_REGEX/;
    expect(files.filter((file) => banned.test(readFileSync(file, 'utf8')))).toEqual([]);
    const catalog = readFileSync(
      path.resolve(process.cwd(), 'src/server/parts/catalog.ts'),
      'utf8',
    );
    const kindSql = catalog.slice(catalog.indexOf('export const ITEM_KIND_SQL'));
    expect(kindSql.slice(0, kindSql.indexOf(';'))).not.toMatch(/~\*|itemName/);
  });
});

describe('AC-301·AC-302 축소 픽스처 파싱', () => {
  it('헤더 2행 탐지, 39헤더 인식(경고 0), raw 키 ⊆ raw 헤더(+NBSP 품명 원문), 빈 값 키 없음, 개인정보 미저장', async () => {
    const sheet = await readItemFixture('wapples');
    const outcome = await parseBuffer(await itemXlsx(sheet));
    expect(outcome).toMatchObject({ status: 'parsed', headerRowIndex: 1, errorCount: 0 });
    expect(outcome.warnings).toEqual([]);
    expect(outcome.droppedColumns).toEqual(ITEM_EXCLUDED_HEADERS);
    const allowed = new Set([...ITEM_RAW_HEADERS, '품명']);
    for (const { row } of outcome.rows) {
      for (const [key, value] of Object.entries(row.raw)) {
        expect(allowed.has(key)).toBe(true);
        expect(value === null || value === '').toBe(false);
      }
      expect(JSON.stringify(row)).not.toContain('가짜등록자');
    }
    const nbsp = outcome.rows.find(({ row }) => typeof row.raw['품명'] === 'string');
    expect(nbsp).toBeDefined();
    expect(nbsp!.row.itemName).not.toContain(' ');
    expect(String(nbsp!.row.raw['품명'])).toContain(' ');
  });

  it('정규 컬럼: 대분류 원문·정규화, 상태 enum, 날짜, 기준단위 (표본 행 = 원본 셀)', async () => {
    const sheet = await readItemFixture('d-amo');
    const outcome = await parseBuffer(await itemXlsx(sheet));
    const first = sheet.rows[0]!;
    const parsed = outcome.rows[0]!.row;
    expect(parsed).toMatchObject({
      itemCode: cellOf(sheet, first, '품번'),
      categoryMajorRaw: "D'Amo",
      categoryMajor: 'D.AMO',
      categoryMid: cellOf(sheet, first, '품목중분류'),
      categoryMinor: cellOf(sheet, first, '품목소분류'),
      itemStatusRaw: cellOf(sheet, first, '품목 상태'),
      baseUnit: cellOf(sheet, first, '기준단위') ?? null,
      erpRegisteredOn: cellOf(sheet, first, '등록일'),
    });
  });

  it('필수 헤더 1개 삭제 → 파일 failed + missing_required_header / 비필수 삭제 → missing_header 경고 / 헤더 추가 → extra_header 경고·raw 미저장', async () => {
    const sheet = await readItemFixture('cloudbric');
    const drop = (name: string) => {
      const index = sheet.header.indexOf(name);
      return {
        header: sheet.header.filter((_, i) => i !== index),
        rows: sheet.rows.map((row) => row.filter((_, i) => i !== index)),
      };
    };
    const missingRequired = await parseBuffer(await itemXlsx(drop('품목 상태')));
    expect(missingRequired.status).toBe('failed');
    expect(missingRequired.errors[0]).toMatchObject({ code: 'missing_required_header' });
    const missingOptional = await parseBuffer(await itemXlsx(drop('규격')));
    expect(missingOptional.warnings).toEqual([
      expect.objectContaining({ code: 'missing_header', column: '규격' }),
    ]);
    const extra = await parseBuffer(
      await itemXlsx({
        header: [...sheet.header, '담당자연락처'],
        rows: sheet.rows.map((row) => [...row, 'EXTRA-SECRET-VALUE']),
      }),
    );
    expect(extra.warnings).toEqual([
      expect.objectContaining({ code: 'extra_header', column: '담당자연락처' }),
    ]);
    expect(JSON.stringify(extra.rows)).not.toContain('EXTRA-SECRET-VALUE');
  });

  it('AC-305 행 오류: 대분류 D-Amo → unknown_major, 상태 보류 → unmapped_status, 품번 형식 오류', async () => {
    const sheet = await readItemFixture('cloudbric');
    const rows = [
      withCell(sheet, sheet.rows[0]!, '품목대분류', 'D-Amo'),
      withCell(sheet, sheet.rows[1]!, '품목 상태', '보류'),
      withCell(sheet, sheet.rows[2]!, '품번', 'X-123'),
      ...sheet.rows.slice(3),
    ];
    const outcome = await parseBuffer(await itemXlsx({ header: sheet.header, rows }));
    expect(outcome.errors.map((error) => [error.code, error.column])).toEqual([
      ['unknown_major', '품목대분류'],
      ['unmapped_status', '품목 상태'],
      [undefined, '품번'],
    ]);
    expect(outcome.rows).toHaveLength(sheet.rows.length - 3);
  });
});
