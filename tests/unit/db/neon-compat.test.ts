// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * PRAMI-003 §4.3.5 Neon 풀링(PgBouncer transaction mode) 비호환 SQL 정적 검사 (AC-325).
 * 세션 advisory lock(xact 변형 제외)·LISTEN·CREATE TEMP·SQL PREPARE 는 런타임 코드(src·scripts)와 마이그레이션(drizzle) 모두 금지,
 * 세션 설정 `SET <파라미터>`·`set_config(…, false)` 는 런타임 코드에서 금지(마이그레이션 SQL 은 직접 연결이라 허용).
 * 트랜잭션 범위 설정(`SET LOCAL`, `SET TRANSACTION`, `SET CONSTRAINTS`, `set_config(…, true)`)과 `pg_advisory_xact_lock` 은 안전하다.
 * 키워드는 대소문자를 구분하지 않는다(PR-2 QA M-2). 런타임 `SET` 은 파라미터 이름과 무관하게 잡고, 같은 SQL 문(직전 `;`·백틱 이후)에
 * `UPDATE` 가 있으면 `UPDATE … SET`·`ON CONFLICT DO UPDATE SET` 으로 보고 제외한다(여러 줄 SQL 포함 — 파일 전체를 본다).
 */
type Rule = {
  name: string;
  pattern: RegExp;
  scope: 'all' | 'runtime';
  /** 매치 위치 앞 같은 SQL 문 문맥으로 제외할지 */
  skip?: (statementPrefix: string) => boolean;
};

const RULES: Rule[] = [
  {
    name: '세션 advisory lock',
    pattern: /\bpg_(try_)?advisory_lock(_shared)?\s*\(/gi,
    scope: 'all',
  },
  { name: 'LISTEN/NOTIFY 구독', pattern: /\bLISTEN\s+["\w*]/gi, scope: 'all' },
  {
    name: '임시 테이블',
    pattern: /\bCREATE\s+(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+TABLE\b/gi,
    scope: 'all',
  },
  { name: 'SQL PREPARE', pattern: /\bPREPARE\s+\w+\s*(\(|AS\b)/gi, scope: 'all' },
  {
    name: '런타임 세션 SET',
    // SET <이름> =|TO, SET SESSION·ROLE·TIME ZONE·NAMES·SCHEMA. LOCAL·TRANSACTION·CONSTRAINTS 는 트랜잭션 범위라 허용
    pattern:
      /\bSET\s+(?!LOCAL\b|TRANSACTION\b|CONSTRAINTS\b)(SESSION\b|ROLE\b|TIME\s+ZONE\b|NAMES\b|SCHEMA\b|"?[a-z_][\w.]*"?\s*(=|\bTO\b))/gi,
    scope: 'runtime',
    skip: (statementPrefix) => /\bUPDATE\b/i.test(statementPrefix),
  },
  {
    name: '런타임 세션 set_config',
    // 인자 안의 함수 호출(괄호 한 단계)까지 허용: set_config('x', current_setting('y'), false)
    pattern: /\bset_config\s*\((?:[^()]|\([^()]*\))*,\s*false\s*\)/gi,
    scope: 'runtime',
  },
];

/** 매치 직전의 같은 SQL 문 — 마지막 `;` 또는 백틱(sql 템플릿 시작) 이후 */
function statementPrefix(text: string, index: number): string {
  const before = text.slice(0, index);
  return before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('`')) + 1);
}

function scanNeonCompat(file: string, text: string, runtime: boolean): string[] {
  const lineOf = (index: number) => text.slice(0, index).split('\n').length;
  return RULES.filter((rule) => rule.scope === 'all' || runtime)
    .flatMap((rule) =>
      [...text.matchAll(rule.pattern)]
        .filter((match) => !rule.skip?.(statementPrefix(text, match.index)))
        .map((match) => ({ line: lineOf(match.index), name: rule.name })),
    )
    .sort((a, b) => a.line - b.line)
    .map(({ line, name }) => `${file}:${line} ${name}`);
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
  it('src·scripts(런타임)·drizzle(마이그레이션)에 비호환 SQL 이 없다', () => {
    const runtimeFiles = [
      ...walk(path.join(ROOT, 'src'), /\.(ts|tsx|sql)$/),
      ...walk(path.join(ROOT, 'scripts'), /\.(ts|sql)$/),
    ];
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
    // PR-2 QA M-2: 소문자·파라미터 목록 밖·키워드 형식·set_config
    ['sql`listen price_changes`', 'LISTEN/NOTIFY 구독'],
    ['await client.query(\'Listen "chan"\')', 'LISTEN/NOTIFY 구독'],
    ['sql`SET work_mem = 1`', '런타임 세션 SET'],
    ["sql`set datestyle to 'ISO'`", '런타임 세션 SET'],
    ['sql`SET "lock_timeout" = 10`', '런타임 세션 SET'],
    ['sql`set role app_admin`', '런타임 세션 SET'],
    ["sql`SET TIME ZONE 'UTC'`", '런타임 세션 SET'],
    ['sql`set session authorization app`', '런타임 세션 SET'],
    ["sql`select set_config('search_path', 'x', false)`", '런타임 세션 set_config'],
    [
      "sql`select set_config('search_path', current_setting('app.schema'), FALSE)`",
      '런타임 세션 set_config',
    ],
    ['prepare q1 as select 1;', 'SQL PREPARE'],
    ['create Temp table t (id int);', '임시 테이블'],
    ['select PG_ADVISORY_LOCK_SHARED(1)', '세션 advisory lock'],
    ['update items set a = 1; SET work_mem = 1', '런타임 세션 SET'],
  ])('위반 주입 %s → %s 로 잡는다', (line, rule) => {
    expect(scanNeonCompat('injected.ts', line, true)).toEqual([`injected.ts:1 ${rule}`]);
  });

  it('허용: xact 락·SET LOCAL·SET TRANSACTION·UPDATE … SET·prepare 식별자, 마이그레이션의 세션 SET', () => {
    const allowed = [
      'select pg_advisory_xact_lock(hashtext($1))',
      "SET LOCAL statement_timeout = '5s'",
      'SET TRANSACTION READ ONLY',
      'update items set item_status = $1',
      'update "items" set "source" = $1',
      'insert into t (a) values (1) on conflict (a) do update set a = excluded.a',
      'SET CONSTRAINTS ALL DEFERRED',
      "select set_config('app.user', $1, true)",
      'db.update(items).set({ status })',
      ".addNode('prepare', makePrepare(features))",
      'element.addEventListener("x", listener)',
    ];
    for (const line of allowed) expect(scanNeonCompat('ok.ts', line, true)).toEqual([]);
    // 여러 줄 UPDATE … SET (실제 코드 형태)
    const multiline =
      'export const X = sql`\n  update material_costs\n  set is_latest = false\n  where id = 1`;';
    expect(scanNeonCompat('ok.ts', multiline, true)).toEqual([]);
    // 다음 문장의 SET 은 앞 문장의 UPDATE 로 가려지지 않고 줄 번호도 맞다
    const next = 'const a = sql`update t set x = 1`;\nconst b = sql`\n\nset work_mem = 1`;';
    expect(scanNeonCompat('bad.ts', next, true)).toEqual(['bad.ts:4 런타임 세션 SET']);
    expect(scanNeonCompat('0001.sql', "SET search_path = 'public';", false)).toEqual([]);
  });
});
