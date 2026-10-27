// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { safeErrorMessage } from '@/server/procurement/transfer/errors';
import {
  csvTableRows,
  normalizeCsvValue,
  parseCsv,
  parseSourceArgs,
  readCsvSource,
  sourceCounts,
} from '@/server/procurement/transfer/source';

import { parseDataVerifyArgs } from '../../../scripts/data-verify';
import { parseProcurementImportArgs } from '../../../scripts/procurement-import';

/**
 * 조달이 통합 DB-3 — 이관 원본 해석(CSV·인자)·오류 값 가림. 합성 데이터만 쓴다.
 */
const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/procurement');

describe('parseCsv', () => {
  it('UTF-8 BOM 을 떼고 CRLF·따옴표 안 쉼표·줄바꿈·"" 이스케이프를 처리한다', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'line1\nline2', ''],
    ]);
  });

  it('끝 줄바꿈이 없어도 마지막 행을 읽고, 닫히지 않은 따옴표는 거부한다', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(() => parseCsv('a\n"open')).toThrowError(/따옴표/);
  });
});

describe('normalizeCsvValue', () => {
  it('빈 칸은 타입과 무관하게 NULL', () => {
    for (const type of ['text', 'bigint', 'boolean', 'text[]', 'jsonb', 'date'] as const) {
      expect(normalizeCsvValue('', type)).toBeNull();
    }
  });

  it('bool: t/f·true/false·1/0·y/n → t/f, 그 밖은 해석 불가', () => {
    expect(['t', 'TRUE', '1', 'y', 'Yes'].map((v) => normalizeCsvValue(v, 'boolean'))).toEqual([
      't',
      't',
      't',
      't',
      't',
    ]);
    expect(['f', 'False', '0', 'n', 'NO'].map((v) => normalizeCsvValue(v, 'boolean'))).toEqual([
      'f',
      'f',
      'f',
      'f',
      'f',
    ]);
    expect(normalizeCsvValue('maybe', 'boolean')).toBeUndefined();
  });

  it('배열: {..} 리터럴은 그대로, JSON 배열은 리터럴로 바꾸고 그 밖은 해석 불가', () => {
    expect(normalizeCsvValue('{a,"b c"}', 'text[]')).toBe('{a,"b c"}');
    expect(normalizeCsvValue('{}', 'text[]')).toBe('{}');
    expect(normalizeCsvValue('["x","y \\"z\\"",null]', 'text[]')).toBe('{"x","y \\"z\\"",NULL}');
    expect(normalizeCsvValue('a,b', 'text[]')).toBeUndefined();
    expect(normalizeCsvValue('[broken', 'text[]')).toBeUndefined();
  });

  it('그 밖의 타입은 원문 그대로(대상 DB 캐스트가 검증)', () => {
    expect(normalizeCsvValue('2024-01-02', 'date')).toBe('2024-01-02');
    expect(normalizeCsvValue('{"k": 1}', 'jsonb')).toBe('{"k": 1}');
  });
});

describe('csvTableRows', () => {
  const header = 'updated_at,key,value';

  it('헤더 순서와 무관하게 명세 열 순서로 바꾼다', () => {
    expect(
      csvTableRows('app_state', `${header}\n2024-01-01 00:00:00+00,k1,"{""a"": 1}"\n`),
    ).toEqual([['k1', '{"a": 1}', '2024-01-01 00:00:00+00']]);
  });

  it('헤더 열이 빠지거나 모르는 열·중복이 있으면 거부한다', () => {
    expect(() => csvTableRows('app_state', 'key,value\n')).toThrowError(/빠짐: updated_at/);
    expect(() => csvTableRows('app_state', `${header},extra\n`)).toThrowError(/모름: extra/);
    expect(() => csvTableRows('app_state', `${header},key\n`)).toThrowError(/헤더가 명세와/);
    expect(() => csvTableRows('app_state', '')).toThrowError(/헤더가 없습니다/);
  });

  it('칸 수·bool 오류는 행·열 위치만 알리고 값은 담지 않는다', () => {
    expect(() => csvTableRows('app_state', `${header}\nSECRET-1,k\n`)).toThrowError(
      /app_state\.csv 2행: 칸 수 2/,
    );
    const items = readCsvSource(FIXTURES).items;
    expect(items).toHaveLength(5);
    const bad = `id,item_id,product,product_group,detail_category,manufacturer,item_name,registered_on,collected_on,status,reviewed,source,created_at,updated_at
1,X,WAPPLES,,,,,,,active,SECRET-BOOL,auto,2024-01-01,2024-01-01`;
    let message = '';
    try {
      csvTableRows('items', bad);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('items.csv 2행 reviewed: boolean 로 해석할 수 없습니다');
  });
});

describe('readCsvSource', () => {
  it('합성 픽스처 8개 표를 읽는다 (BOM 파일·따옴표 안 줄바꿈 포함)', () => {
    const data = readCsvSource(FIXTURES);
    expect(sourceCounts(data)).toEqual({
      items: 5,
      item_changes: 3,
      deliveries: 7,
      delivery_changes: 2,
      bid_notices: 2,
      bid_keywords: 3,
      job_runs: 2,
      app_state: 2,
    });
    expect(data.items[0]![0]).toBe('1'); // BOM 이 첫 열 이름에 붙지 않음
    expect(data.items[0]![10]).toBe('t');
    expect(data.items[2]![10]).toBe('t'); // 'true'
    expect(data.bid_notices[1]![2]).toBe('{"iSIGN"}'); // JSON 배열 → 리터럴
    expect(data.deliveries[2]![7]).toContain('\n');
  });

  it('파일이 하나라도 없으면 거부한다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'procurement-csv-'));
    try {
      writeFileSync(path.join(dir, 'items.csv'), 'id\n');
      expect(() => readCsvSource(dir)).toThrowError(/CSV 파일이 없습니다: item_changes\.csv/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI 인자', () => {
  it('procurement:import 는 원본이 필요하고 --csv·--source-db 를 함께 쓸 수 없다', () => {
    expect(() => parseProcurementImportArgs([], {})).toThrowError(/원본을 지정하세요/);
    expect(() => parseProcurementImportArgs(['--csv'], {})).toThrowError(/CSV 디렉터리/);
    expect(() =>
      parseProcurementImportArgs(['--csv', 'd', '--source-db'], {
        PROCUREMENT_SOURCE_URL: 'postgres://a@h/x',
      }),
    ).toThrowError(/함께 쓸 수 없습니다/);
    expect(parseProcurementImportArgs(['--csv', 'd', '--replace', '--dry-run'], {})).toEqual({
      source: { kind: 'csv', dir: path.resolve('d') },
      replace: true,
      dryRun: true,
      targetHost: undefined,
    });
  });

  it('--source-db 는 PROCUREMENT_SOURCE_URL 을 쓰고 대상과 같은 접속 문자열이면 거부한다', () => {
    const names = { csv: '--csv', db: '--source-db' };
    expect(() => parseSourceArgs(['--source-db'], {}, names)).toThrowError(
      /PROCUREMENT_SOURCE_URL/,
    );
    const url = 'postgres://reader@source-host/jodari';
    expect(() =>
      parseSourceArgs(['--source-db'], { PROCUREMENT_SOURCE_URL: url, DATABASE_URL: url }, names),
    ).toThrowError(/대상 DATABASE_URL 과 같습니다/);
    expect(
      parseSourceArgs(
        ['--source-db', '--source-schema', 'archive'],
        { PROCUREMENT_SOURCE_URL: url },
        names,
      ),
    ).toEqual({ kind: 'db', url, schema: 'archive' });
  });

  it('data:verify 는 --stage procurement 에서만 원본·--show-amounts 를 받는다', () => {
    const parsed = parseDataVerifyArgs(['--stage', 'procurement', '--source-csv', 'd'], {});
    expect(parsed.stage).toBe('procurement');
    expect(parsed.procurementSource).toEqual({ kind: 'csv', dir: path.resolve('d') });
    expect(parsed.showAmounts).toBe(false);
    expect(parseDataVerifyArgs(['--stage', 'procurement', '--show-amounts']).showAmounts).toBe(
      true,
    );
    expect(parseDataVerifyArgs([]).procurementSource).toEqual({ kind: 'none' });
    expect(() => parseDataVerifyArgs(['--source-csv', 'd'])).toThrowError(/--stage procurement/);
    expect(() => parseDataVerifyArgs(['--show-amounts'])).toThrowError(/--stage procurement/);
  });
});

describe('safeErrorMessage', () => {
  it('Drizzle "Failed query … params" 를 버리고 DB 오류의 따옴표 안 값을 가린다', () => {
    const cause = Object.assign(new Error('invalid input syntax for type bigint: "123456789"'), {
      code: '22P02',
    });
    const error = new Error('Failed query: insert into x values ($1)\nparams: 123456789', {
      cause,
    });
    const message = safeErrorMessage(error);
    expect(message).toBe('invalid input syntax for type bigint: "…" [22P02]');
    expect(message).not.toContain('123456789');
  });
});
