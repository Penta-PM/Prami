// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * PRAMI-003 §4.3.5 Neon 풀링(PgBouncer transaction mode) 비호환 SQL 정적 검사 (AC-325).
 * 세션 advisory lock(xact 변형 제외)·LISTEN·CREATE TEMP·SQL PREPARE 는 런타임 코드(src·scripts)와 마이그레이션(drizzle) 모두 금지,
 * 세션 설정 `SET <파라미터>`·`set_config(…, false)` 는 런타임 코드에서 금지(마이그레이션 SQL 은 직접 연결이라 허용).
 * 트랜잭션 범위 설정(`SET LOCAL`, `SET TRANSACTION`, `SET CONSTRAINTS`, `set_config(…, true)`)과 `pg_advisory_xact_lock` 은 안전하다.
 * 키워드는 대소문자를 구분하지 않는다(PR-2 QA M-2). 런타임 `SET` 은 파라미터 이름과 무관하게 잡고, 같은 SQL 문(직전 `;`·백틱·작은따옴표 이후,
 * 주석 제외)에 `UPDATE` 가 있으면 `UPDATE … SET`·`ON CONFLICT DO UPDATE SET` 으로 보고 제외한다(여러 줄 SQL 포함 — 파일 전체를 본다).
 * PR-2b QA L-N3: 주석 속 "update" 로 가려지지 않게, `set_config` 인자 중첩 깊이와 무관하게, `CREATE TEMP` 는 TABLE 밖(VIEW·SEQUENCE)도 잡는다.
 */
type Rule = {
  name: string;
  pattern: RegExp;
  scope: 'all' | 'runtime';
  /** 매치 위치 앞 같은 SQL 문 문맥으로 제외할지 */
  skip?: (statementPrefix: string) => boolean;
  /** 매치 뒤 본문으로 최종 판정 (괄호 짝 맞추기처럼 정규식으로 어려운 경우) */
  confirm?: (rest: string) => boolean;
};

const RULES: Rule[] = [
  {
    name: '세션 advisory lock',
    pattern: /\bpg_(try_)?advisory_lock(_shared)?\s*\(/gi,
    scope: 'all',
  },
  { name: 'LISTEN/NOTIFY 구독', pattern: /\bLISTEN\s+["\w*]/gi, scope: 'all' },
  {
    name: '임시 객체(CREATE TEMP)',
    // TABLE·VIEW·SEQUENCE·RECURSIVE VIEW 모두 세션 범위 객체. SELECT … INTO TEMP 도 임시 테이블을 만든다
    pattern:
      /\bCREATE\s+(OR\s+REPLACE\s+)?(GLOBAL\s+|LOCAL\s+)?TEMP(ORARY)?\s+\w|\bINTO\s+TEMP(ORARY)?\s+(TABLE\s+)?["\w]/gi,
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
    // 세 번째(마지막) 인자가 false 인지 괄호 짝을 맞춰 본다 — set_config('a', coalesce(current_setting('b'), 'c'), false)
    pattern: /\bset_config\s*\(/gi,
    scope: 'runtime',
    confirm: (rest) => /^\s*false\s*$/i.test(lastTopLevelArgument(rest) ?? ''),
  },
];

/** `(` 바로 뒤 본문에서 짝이 맞는 `)` 까지의 마지막 최상위 인자. 짝이 없으면 null */
function lastTopLevelArgument(rest: string): string | null {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const char = rest[i];
    if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) return rest.slice(start, i);
      depth -= 1;
    } else if (char === ',' && depth === 0) start = i + 1;
  }
  return null;
}

/** 매치 직전의 같은 SQL 문 — 마지막 `;`·백틱(sql 템플릿 시작)·작은따옴표(문자열 SQL 시작) 이후, 주석(`--`·`//`·블록) 제외 */
function statementPrefix(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf(';'), before.lastIndexOf('`'), before.lastIndexOf("'"));
  return before.slice(start + 1).replace(/--[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
}

function scanNeonCompat(file: string, text: string, runtime: boolean): string[] {
  const lineOf = (index: number) => text.slice(0, index).split('\n').length;
  return RULES.filter((rule) => rule.scope === 'all' || runtime)
    .flatMap((rule) =>
      [...text.matchAll(rule.pattern)]
        .filter((match) => !rule.skip?.(statementPrefix(text, match.index)))
        .filter((match) => !rule.confirm || rule.confirm(text.slice(match.index + match[0].length)))
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
    ['CREATE TEMP TABLE tmp_items AS SELECT 1;', '임시 객체(CREATE TEMP)'],
    ['create temporary table t (id int);', '임시 객체(CREATE TEMP)'],
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
    ['create Temp table t (id int);', '임시 객체(CREATE TEMP)'],
    ['select PG_ADVISORY_LOCK_SHARED(1)', '세션 advisory lock'],
    ['update items set a = 1; SET work_mem = 1', '런타임 세션 SET'],
    // PR-2b QA L-N3: 주석 속 update·2단 중첩 set_config·TABLE 밖 CREATE TEMP
    ["/* update later */ await client.query('SET work_mem = 1')", '런타임 세션 SET'],
    ['sql`/* update cache */ set work_mem = 1`', '런타임 세션 SET'],
    ["db.update(t); /* update */ client.query('set lock_timeout = 5')", '런타임 세션 SET'],
    [
      "sql`select set_config('a', coalesce(current_setting('b'), 'c'), false)`",
      '런타임 세션 set_config',
    ],
    [
      "sql`select set_config('a', concat(coalesce(current_setting('b'), 'c'), 'd'), FALSE)`",
      '런타임 세션 set_config',
    ],
    ['create temp view v as select 1;', '임시 객체(CREATE TEMP)'],
    ['CREATE TEMPORARY SEQUENCE s;', '임시 객체(CREATE TEMP)'],
    ['create or replace temp view v as select 1', '임시 객체(CREATE TEMP)'],
    ['select * into temp t_copy from items', '임시 객체(CREATE TEMP)'],
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
      "await client.query('update items set a = $1 where id = $2')",
      "sql`with x as (select 'a' as v) update t set v = x.v from x`",
      "select set_config('a', coalesce(current_setting('b', true), 'c'), true)",
      'create table tempo (id int)',
      'select temp_col into t_target from t_source',
    ];
    for (const line of allowed) expect(scanNeonCompat('ok.ts', line, true)).toEqual([]);
    // 여러 줄 UPDATE … SET (실제 코드 형태)
    const multiline =
      'export const X = sql`\n  update material_costs\n  set is_latest = false\n  where id = 1`;';
    expect(scanNeonCompat('ok.ts', multiline, true)).toEqual([]);
    // 다음 문장의 SET 은 앞 문장의 UPDATE 로 가려지지 않고 줄 번호도 맞다
    const next = 'const a = sql`update t set x = 1`;\nconst b = sql`\n\nset work_mem = 1`;';
    expect(scanNeonCompat('bad.ts', next, true)).toEqual(['bad.ts:4 런타임 세션 SET']);
    // PR-2b QA L-N3: 줄 주석 속 "update" 는 UPDATE … SET 문맥이 아니다 (JS `//`·SQL `--`)
    const commented =
      "// update the cache\nawait client.query('SET work_mem = 1');\nsql`-- update x\nset lock_timeout = 5`;";
    expect(scanNeonCompat('bad.ts', commented, true)).toEqual([
      'bad.ts:2 런타임 세션 SET',
      'bad.ts:4 런타임 세션 SET',
    ]);
    expect(scanNeonCompat('0001.sql', "SET search_path = 'public';", false)).toEqual([]);
  });
});
