/**
 * 로컬 preview 모의 전용 preload (PRAMI-003 AC-361, `pnpm smoke:local`) — 운영 코드에 넣지 않는다.
 * preview 기동 검사 ⓔ 는 DB_DRIVER=neon + 사설이 아닌 호스트를 요구하므로, 앱은 `*.neon-smoke.test` 호스트로 Neon HTTP 드라이버를
 * 쓰고 이 preload 가 그 요청(`POST https://api.<host>/sql`)만 가로채 격리 Postgres(SMOKE_PG_URL)로 실행한다.
 * Neon HTTP 응답 형식(@neondatabase/serverless 1.x): `{ fields:[{name,dataTypeID}], rows:[[text…]], command, rowCount }`,
 * 배치는 `{ results:[…] }`, SQL 오류는 400 `{ message, code }`. 값은 원문 텍스트로 돌려주고 드라이버가 타입 변환한다.
 * WebSocket(트랜잭션) 경로는 다루지 않는다 — 스모크 8항목은 트랜잭션을 쓰지 않는다.
 */
import pg from 'pg';

const SUFFIX = '.neon-smoke.test';
const target = process.env.SMOKE_PG_URL;
if (!target) throw new Error('[neon-local-fetch] SMOKE_PG_URL 이 필요합니다');

const pool = new pg.Pool({ connectionString: target, max: 4 });
const rawText = { getTypeParser: () => (value) => value };
const originalFetch = globalThis.fetch;

async function run(query) {
  const result = await pool.query({
    text: query.query,
    values: query.params ?? [],
    rowMode: 'array',
    types: rawText,
  });
  return {
    fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
    rows: result.rows,
    command: result.command,
    rowCount: result.rowCount,
  };
}

globalThis.fetch = async function smokeNeonFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!url.hostname.endsWith(SUFFIX) || url.pathname !== '/sql') return originalFetch(input, init);
  try {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const payload = Array.isArray(body.queries)
      ? { results: await Promise.all(body.queries.map(run)) }
      : await run(body);
    return Response.json(payload);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : 'error', code: error?.code },
      { status: 400 },
    );
  }
};
