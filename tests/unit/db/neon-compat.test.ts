// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * PRAMI-003 §4.3.5 Neon 풀링(PgBouncer transaction mode) 비호환 SQL 정적 검사 (AC-325).
 * 세션 advisory lock(xact 변형 제외)·LISTEN·CREATE TEMP·SQL PREPARE 는 런타임 코드(src)와 마이그레이션(drizzle) 모두 금지,
 * 세션 설정 `SET`(SESSION·search_path·statement_timeout 등)은 런타임 코드에서 금지(마이그레이션 SQL 은 직접 연결이라 허용).
 * 트랜잭션 범위 설정(`SET LOCAL`, `SET TRANSACTION`)과 `pg_advisory_xact_lock` 은 transaction mode 에서 안전하다.
 */
type Rule = { name: string; pattern: RegExp; scope: 'all' | 'runtime' };

const RULES: Rule[] = [
  {
    name: '세션 advisory lock',
    pattern: /\bpg_(try_)?advisory_lock(_shared)?\s*\(/i,
    scope: 'all',
  },
  { name: 'LISTEN/NOTIFY 구독', pattern: /\bLISTEN\s+["\w]/, scope: 'all' },
  {
    name: '임시 테이블',
    pattern: /\bCREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE\b/i,
    scope: 'all',
  },
  { name: 'SQL PREPARE', pattern: /\bPREPARE\s+\w+\s*(\(|AS\b)/, scope: 'all' },
  {
    name: '런타임 세션 SET',
    pattern:
      /\bSET\s+(SESSION\b|search_path\b|statement_timeout\b|lock_timeout\b|idle_in_transaction_session_timeout\b|role\b|application_name\b|TIME\s+ZONE\b|client_encoding\b)/i,
    scope: 'runtime',
  },
];

function scanNeonCompat(file: string, text: string, runtime: boolean): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) =>
      RULES.filter((rule) => (rule.scope === 'all' || runtime) && rule.pattern.test(line)).map(
        (rule) => `${file}:${index + 1} ${rule.name}`,
      ),
    );
}

const ROOT = path.resolve(import.meta.dirname, '../../..');

function walk(dir: string, accept: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, accept);
    return accept.test(name) ? [full] : [];
  });
}

describe('Neon transaction pooling 호환 (AC-325)', () => {
  it('src(런타임)·drizzle(마이그레이션)에 비호환 SQL 이 없다', () => {
    const runtimeFiles = walk(path.join(ROOT, 'src'), /\.(ts|tsx|sql)$/);
    const migrationFiles = walk(path.join(ROOT, 'drizzle'), /\.sql$/);
    expect(runtimeFiles.length).toBeGreaterThan(100);
    expect(migrationFiles.length).toBeGreaterThanOrEqual(7);
    const findings = [
      ...runtimeFiles.map((file) => scanNeonCompat(file, readFileSync(file, 'utf8'), true)),
      ...migrationFiles.map((file) => scanNeonCompat(file, readFileSync(file, 'utf8'), false)),
    ].flat();
    expect(findings).toEqual([]);
  });

  it.each([
    ['sql`select pg_advisory_lock(${key})`', '세션 advisory lock'],
    ['sql`select pg_try_advisory_lock(1)`', '세션 advisory lock'],
    ['LISTEN price_changes;', 'LISTEN/NOTIFY 구독'],
    ['CREATE TEMP TABLE tmp_items AS SELECT 1;', '임시 테이블'],
    ['create temporary table t (id int);', '임시 테이블'],
    ['PREPARE q1 AS SELECT 1;', 'SQL PREPARE'],
    ["sql`SET statement_timeout = '5s'`", '런타임 세션 SET'],
    ['sql`set search_path to public`', '런타임 세션 SET'],
    ['SET SESSION lock_timeout = 1000', '런타임 세션 SET'],
  ])('위반 주입 %s → %s 로 잡는다', (line, rule) => {
    expect(scanNeonCompat('injected.ts', line, true)).toEqual([`injected.ts:1 ${rule}`]);
  });

  it('허용: xact 락·SET LOCAL·SET TRANSACTION·UPDATE … SET·prepare 식별자, 마이그레이션의 세션 SET', () => {
    const allowed = [
      'select pg_advisory_xact_lock(hashtext($1))',
      "SET LOCAL statement_timeout = '5s'",
      'SET TRANSACTION READ ONLY',
      'update items set item_status = $1',
      ".addNode('prepare', makePrepare(features))",
      'element.addEventListener("x", listener)',
    ];
    for (const line of allowed) expect(scanNeonCompat('ok.ts', line, true)).toEqual([]);
    expect(scanNeonCompat('0001.sql', "SET search_path = 'public';", false)).toEqual([]);
  });
});
