import { createServer } from 'node:http';
import { connect } from 'node:net';

import type { neonConfig as NeonConfig } from '@neondatabase/serverless';
import pg from 'pg';
import { WebSocketServer } from 'ws';

/**
 * `pnpm test:neon` 로컬 예행 전용 (PR #26 D-2) — 실제 Neon 대신 격리 Postgres 로 **Neon 드라이버 코드 그대로**를 돌린다.
 * - HTTP(neon-http): `neonConfig.fetchFunction` 이 `POST https://<호스트>/sql` 을 받아 격리 PG 에 실행하고 Neon HTTP 응답 형식으로 돌려준다
 *   (형식은 scripts/smoke/neon-local-fetch.mjs 와 같다)
 * - WebSocket(Pool·트랜잭션): `neonConfig.wsProxy` 를 로컬 ws↔TCP 다리로 돌린다 — Neon wsproxy 처럼 Postgres 프로토콜 바이트를 그대로 전달
 * 운영·CI 기본 경로에서는 쓰지 않는다(NEON_LOCAL_PG_URL 이 있을 때만 tests/neon/setup.ts 가 설치).
 */
export const NEON_LOCAL_HOST = 'ep-local.neon-local.test';

type NeonQuery = { query: string; params?: unknown[] };

export type NeonLocal = { databaseUrl: string; close: () => Promise<void> };

export async function installNeonLocal(
  neonConfig: typeof NeonConfig,
  pgUrl: string,
): Promise<NeonLocal> {
  const target = new URL(pgUrl);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port === '5432') {
    throw new Error(
      'NEON_LOCAL_PG_URL 은 로컬 격리 컨테이너여야 합니다 (:5432 금지 — 로컬 실데이터 보호)',
    );
  }
  const pool = new pg.Pool({ connectionString: pgUrl, max: 4 });
  const rawText = { getTypeParser: () => (value: string) => value };

  const run = async (query: NeonQuery) => {
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
  };

  neonConfig.fetchFunction = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.hostname.endsWith('.neon-local.test') || url.pathname !== '/sql') {
      throw new Error('neon-local: 예상 밖 HTTP 대상');
    }
    try {
      const body = JSON.parse(String(init?.body ?? '{}')) as NeonQuery & { queries?: NeonQuery[] };
      // 배치(트랜잭션 없는 HTTP 배치)는 순서대로 실행 — 같은 결과 형식 { results: [...] }
      if (Array.isArray(body.queries)) {
        const results = [];
        for (const query of body.queries) results.push(await run(query));
        return Response.json({ results });
      }
      return Response.json(await run(body));
    } catch (error) {
      return Response.json(
        {
          message: error instanceof Error ? error.message : 'error',
          code: (error as { code?: string }).code,
        },
        { status: 400 },
      );
    }
  };

  // ws ↔ TCP 다리: 요청 주소와 무관하게 격리 PG 로만 잇는다
  const wss = new WebSocketServer({ noServer: true });
  const httpServer = createServer();
  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const tcp = connect(Number(target.port), target.hostname);
      tcp.on('data', (chunk) => ws.send(chunk));
      tcp.on('close', () => ws.close());
      tcp.on('error', () => ws.close());
      ws.on('message', (data) => tcp.write(data as Buffer));
      ws.on('close', () => tcp.end());
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as { port: number };

  neonConfig.wsProxy = () => `127.0.0.1:${port}/v2`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  neonConfig.pipelineTLS = false;

  const databaseUrl = new URL(pgUrl);
  databaseUrl.hostname = NEON_LOCAL_HOST;
  databaseUrl.port = '';
  return {
    databaseUrl: databaseUrl.toString(),
    close: async () => {
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await pool.end();
    },
  };
}
