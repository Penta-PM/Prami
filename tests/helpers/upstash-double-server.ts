/**
 * Upstash REST 테스트 더블 HTTP 서버 (QA-2 ⑥ 수동 확인용 — 실 Upstash 대신 로컬에서 앱 2개가 공유).
 * 사용: `pnpm exec tsx tests/helpers/upstash-double-server.ts <port> <token>` 후 앱을
 * `RATE_LIMIT_BACKEND=upstash UPSTASH_REDIS_REST_URL=http://127.0.0.1:<port> UPSTASH_REDIS_REST_TOKEN=<token>` 으로 띄운다.
 * `POST /__fault` 본문 `{"kind":"status","status":500}` · `{"kind":"delay","ms":300}` · `null` 로 장애를 주입한다.
 */
import { createServer } from 'node:http';

import { createUpstashDouble, type DoubleFault } from './upstash-double';

const port = Number(process.argv[2] ?? 18_079);
const token = process.argv[3] ?? 'local-upstash-double-token';
const double = createUpstashDouble(token);
let delayMs = 0;

createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
  request.on('end', () => {
    const body = raw ? (JSON.parse(raw) as unknown) : null;
    if (request.url === '/__fault') {
      const fault = body as DoubleFault;
      delayMs = fault?.kind === 'delay' ? fault.ms : 0;
      double.setFault(fault?.kind === 'status' ? fault : null);
      response.writeHead(204).end();
      return;
    }
    const result = double.handle(request.url ?? '/', body, request.headers.authorization ?? null);
    setTimeout(() => {
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.body));
    }, delayMs);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`[upstash-double] http://127.0.0.1:${port}`);
});
