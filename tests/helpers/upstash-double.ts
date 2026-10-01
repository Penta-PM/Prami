/**
 * Upstash Redis REST 호환 테스트 더블 (PRAMI-003 AC-328·329). 실 Upstash 호출 없이 여러 limiter 인스턴스가 같은 저장소를 공유한다.
 * 지원: `POST /multi-exec`(명령 배열), `POST /`(명령 1개) — ZREMRANGEBYSCORE·ZADD·ZCARD·ZRANGE(WITHSCORES)·PEXPIRE·ZREM·PING.
 * 토큰 검사(Bearer), 오류·지연 주입, 받은 키 기록(키 접두·원문 IP 부재 검사용)을 제공한다.
 * `tests/helpers/upstash-double-server.ts` 가 같은 로직을 HTTP 서버로 띄운다(QA 수동 확인용).
 */
export type DoubleFault = { kind: 'status'; status: number } | { kind: 'delay'; ms: number } | null;

export type UpstashDouble = {
  fetch: typeof fetch;
  handle: (path: string, body: unknown, authorization: string | null) => DoubleResponse;
  keys: () => string[];
  setFault: (fault: DoubleFault) => void;
  calls: () => number;
};

type DoubleResponse = { status: number; body: unknown };
type Command = string[];

export function createUpstashDouble(token: string): UpstashDouble {
  const sets = new Map<string, Map<string, number>>();
  const seenKeys = new Set<string>();
  let fault: DoubleFault = null;
  let callCount = 0;

  const zset = (key: string) => {
    seenKeys.add(key);
    let set = sets.get(key);
    if (!set) sets.set(key, (set = new Map()));
    return set;
  };

  const sortedEntries = (key: string) =>
    [...zset(key).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  function run(command: Command): unknown {
    const [name, key, ...args] = command;
    switch (name?.toUpperCase()) {
      case 'PING':
        return 'PONG';
      case 'ZREMRANGEBYSCORE': {
        const [min, max] = args.map(Number) as [number, number];
        let removed = 0;
        for (const [member, score] of zset(key!)) {
          if (score >= min && score <= max) {
            zset(key!).delete(member);
            removed += 1;
          }
        }
        return removed;
      }
      case 'ZADD':
        zset(key!).set(args[1]!, Number(args[0]));
        return 1;
      case 'ZCARD':
        return zset(key!).size;
      case 'ZRANGE': {
        const [start, stop] = [Number(args[0]), Number(args[1])];
        const slice = sortedEntries(key!).slice(start, stop + 1);
        return args[2]?.toUpperCase() === 'WITHSCORES'
          ? slice.flatMap(([member, score]) => [member, String(score)])
          : slice.map(([member]) => member);
      }
      case 'PEXPIRE':
        return 1;
      case 'ZREM':
        return zset(key!).delete(args[0]!) ? 1 : 0;
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
  }

  function handle(path: string, body: unknown, authorization: string | null): DoubleResponse {
    callCount += 1;
    if (authorization !== `Bearer ${token}`)
      return { status: 401, body: { error: 'Unauthorized' } };
    if (fault?.kind === 'status') return { status: fault.status, body: { error: 'injected' } };
    try {
      if (path === '/multi-exec' || path === '/pipeline') {
        return {
          status: 200,
          body: (body as Command[]).map((command) => ({ result: run(command) })),
        };
      }
      if (path === '/' || path === '')
        return { status: 200, body: { result: run(body as Command) } };
      return { status: 404, body: { error: 'not found' } };
    } catch (error) {
      return { status: 400, body: { error: (error as Error).message } };
    }
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url);
    const headers = new Headers(init?.headers);
    if (fault?.kind === 'delay') {
      const signal = init?.signal;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, fault?.kind === 'delay' ? fault.ms : 0);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        });
      });
    }
    const result = handle(
      url.pathname,
      JSON.parse(String(init?.body ?? 'null')),
      headers.get('authorization'),
    );
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    fetch: fetchImpl,
    handle,
    keys: () => [...seenKeys],
    setFault: (next) => {
      fault = next;
    },
    calls: () => callCount,
  };
}
