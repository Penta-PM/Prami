// @vitest-environment node
import { createRequire } from 'node:module';

import { Client as NeonClient, neon, neonConfig } from '@neondatabase/serverless';
import { afterEach, describe, expect, it } from 'vitest';

import { seedTargetViolation } from '@/db/seed';
import { dbHostOf, isPrivateDbHost, isRemoteDbTarget, targetHostViolation } from '@/lib/db-host';

/**
 * PR-2 QA M-1 회귀: `DATABASE_URL` 의 호스트 판정은 드라이버가 실제로 연결할 호스트와 같아야 하고,
 * 판정할 수 없으면 null(원격 취급, fail-closed)이어야 한다. `?host=` 로 seed·--target-host 가드를 우회하던 경로를 막는다.
 */

// node-postgres 가 쓰는 파서 (pg 의 의존성 — 저장소 직접 의존성이 아니라 pg 위치에서 찾는다)
const requireFromPg = createRequire(createRequire(import.meta.url).resolve('pg'));
const { parse: pgParse } = requireFromPg('pg-connection-string') as {
  parse: (url: string) => { host?: string | null };
};

const AMBIGUOUS = [
  // libpq·pg 가 URL 호스트보다 우선하는 쿼리 파라미터
  'postgres://prami:prami@localhost:5443/seedguard?host=example-remote-host',
  'postgres://prami:prami@localhost/x?sslmode=disable&host=example-remote-host',
  'postgres://prami:prami@localhost/x?hostaddr=203.0.113.7',
  'postgres://prami:prami@localhost/x?HOST=example-remote-host',
  'postgres://prami:prami@localhost/x?service=prod',
  'postgres://prami:prami@localhost/x?servicefile=/tmp/pg_service.conf',
  'postgres://prami:prami@localhost/x?host=%2Fvar%2Frun%2Fpostgresql',
  // URL 호스트 없음 → 드라이버가 PGHOST·소켓으로 대체
  'postgres://prami:prami@/x',
  'postgres:///x',
  'postgresql://prami@/x?host=/var/run/postgresql',
  // 소켓 경로·key=value 형식·다른 스킴
  '/var/run/postgresql prami',
  'host=localhost dbname=prami',
  'socket://prami@/var/run/postgresql?db=prami',
  'http://localhost/x',
  'localhost:5432/prami',
  // 퍼센트 인코딩(pg 는 디코딩한다)·다중 호스트·비정규 숫자 IPv4
  'postgres://prami@local%68ost/x',
  'postgres://prami@%2Fvar%2Frun%2Fpostgresql/x',
  'postgres://prami@localhost,example-remote-host/x',
  'postgres://prami@127.1/x',
  'postgres://prami@0x7f.0.0.1/x',
  'postgres://prami@2130706433/x',
  // Neon 드라이버(`http:` 로 다시 파싱)는 `\` 를 authority 끝으로 본다 — pg 와 호스트가 갈린다 (PR-2b QA L-N1)
  'postgresql://u:pw@localhost\\@ep-x.example.neon.tech/db',
  'postgresql://u:pw@10.0.0.5\\@ep-x.example.neon.tech/db',
  'postgresql://u:pw@ep-x.example.neon.tech\\@localhost/db',
  'postgresql://u:pw@ep-x.example.neon.tech\\/db',
  '',
  undefined,
];

describe('dbHostOf — 판정 불가는 null (QA M-1)', () => {
  it.each(AMBIGUOUS.map((url) => [String(url)]))('%s → null', (url) => {
    const value = url === 'undefined' ? undefined : url;
    expect(dbHostOf(value)).toBeNull();
  });

  it('일반 URL 은 호스트를 돌려준다 (Neon·로컬·IPv6·무관한 쿼리 파라미터)', () => {
    expect(
      dbHostOf(
        'postgresql://app:pw@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      ),
    ).toBe('ep-x-pooler.ap-southeast-1.aws.neon.tech');
    expect(dbHostOf('postgres://prami:prami@LOCALHOST:5432/prami?sslmode=disable')).toBe(
      'localhost',
    );
    expect(dbHostOf(' postgres://u@127.0.0.1/x ')).toBe('127.0.0.1');
    expect(dbHostOf('postgres://u@[::1]:5432/x')).toBe('::1');
    expect(dbHostOf('postgres://u@10.0.0.5/x?application_name=prami')).toBe('10.0.0.5');
    // 끝의 점(FQDN 표기)은 같은 주소 — 떼고 판정해 사설 주소 검사를 피하지 못하게 한다
    expect(dbHostOf('postgres://u@localhost./x')).toBe('localhost');
    expect(dbHostOf('postgres://u@10.0.0.5./x')).toBe('10.0.0.5');
    expect(isPrivateDbHost(dbHostOf('postgres://u@10.0.0.5./x'))).toBe(true);
    expect(dbHostOf('postgres://u@localhost../x')).toBeNull();
  });

  it('pg-connection-string 과 대조: 호스트를 돌려주면 드라이버가 연결할 호스트와 같다', () => {
    expect(DIFF_CORPUS.filter((url) => dbHostOf(url) !== null).length).toBeGreaterThanOrEqual(10);
    for (const url of DIFF_CORPUS) {
      const ours = dbHostOf(url);
      if (ours === null) continue;
      expect({ url, host: driverHost(pgParse(url).host) }).toEqual({ url, host: ours });
    }
  });
});

/** 드라이버의 호스트 표기를 dbHostOf 와 같은 형식으로 (소문자·IPv6 괄호 제거·끝의 점 하나 = 같은 주소) */
function driverHost(host: string | null | undefined): string {
  return String(host ?? '')
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
}

const DIFF_CORPUS = [
  'postgres://u:p@localhost:5432/x',
  'postgresql://u:pw@Example-Remote-Host/x?sslmode=require',
  'postgresql://app:pw@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  'postgresql://app:pw@EP-X.example.neon.tech./neondb',
  'postgres://u:pw@[::1]/x',
  'postgres://u:pw@[0:0:0:0:0:0:0:1]:5432/x',
  'postgres://u:pw@[2001:db8::5]/x',
  'postgres://u:pw@db/x?application_name=a&options=-c%20x%3D1',
  'postgres://u:pw@postgres:5432/x?ssl=true',
  'postgres://localhost:pw@example-remote-host/x',
  'postgres://u:p%40ss@localhost/x',
  'postgres://u:pw@10.0.0.5./x',
  'postgres://u:pw@127.0.0.1/x',
  ...AMBIGUOUS.filter((url): url is string => Boolean(url)),
];

describe('@neondatabase/serverless 와 대조 (PR-2b QA L-N1)', () => {
  const original = {
    fetchEndpoint: neonConfig.fetchEndpoint,
    fetchFunction: neonConfig.fetchFunction,
  };
  afterEach(() => {
    neonConfig.fetchEndpoint = original.fetchEndpoint;
    neonConfig.fetchFunction = original.fetchFunction;
  });

  /** neon() HTTP 경로가 요청할 호스트 — fetch 를 가로채 네트워크 없이 확인한다 */
  async function neonHttpHost(url: string): Promise<string | null> {
    let host: string | null = null;
    neonConfig.fetchEndpoint = (h) => {
      host = h;
      return 'https://captured.invalid/sql';
    };
    neonConfig.fetchFunction = () => Promise.reject(new Error('captured'));
    try {
      await neon(url)`select 1`;
    } catch {
      // 의도한 중단 (또는 드라이버가 URL 을 거부 → host null)
    }
    return host;
  }

  function neonPoolHost(url: string): string | null {
    try {
      return new NeonClient(url).host;
    } catch {
      return null;
    }
  }

  it('역슬래시 우회 URL 은 Neon 이 실제로 다른 호스트로 연결한다 (재현) → dbHostOf null', async () => {
    const url = 'postgresql://u:pw@localhost\\@ep-x.example.neon.tech/db';
    expect(await neonHttpHost(url)).toBe('localhost');
    expect(neonPoolHost(url)).toBe('localhost');
    expect(dbHostOf(url)).toBeNull();
  });

  it('dbHostOf 가 호스트를 돌려주면 Neon HTTP·Pool 이 연결할 호스트와 같다', async () => {
    for (const url of DIFF_CORPUS) {
      const ours = dbHostOf(url);
      if (ours === null) continue;
      expect({ url, http: driverHost(await neonHttpHost(url)) }).toEqual({ url, http: ours });
      expect({ url, pool: driverHost(neonPoolHost(url)) }).toEqual({ url, pool: ours });
    }
  });
});

describe('판정 불가 URL 은 원격으로 다룬다 (seed·--target-host·운영 사설 주소 검사)', () => {
  const bypass = {
    DB_DRIVER: 'pg',
    DATABASE_URL: 'postgres://prami:prami@localhost:5443/seedguard?host=example-remote-host',
    PRAMI_ALLOW_SEED: '1',
  };

  it('seed 는 remote_host 로 거부한다 (AC-323)', () => {
    expect(seedTargetViolation(bypass)).toBe('remote_host');
    expect(
      seedTargetViolation({ ...bypass, DATABASE_URL: 'postgres://prami:prami@localhost:5443/x' }),
    ).toBeNull();
  });

  it('원격 대상이 되고 --target-host 는 어떤 값으로도 일치하지 않는다 (AC-324)', () => {
    expect(isRemoteDbTarget(bypass)).toBe(true);
    expect(targetHostViolation(bypass, undefined)).toBe('missing');
    expect(targetHostViolation(bypass, 'localhost')).toBe('mismatch');
    expect(targetHostViolation(bypass, 'example-remote-host')).toBe('mismatch');
  });

  it('IPv4 매핑·미지정 IPv6 도 사설 주소로 본다', () => {
    expect(isPrivateDbHost(dbHostOf('postgres://u@[::ffff:127.0.0.1]/x'))).toBe(true);
    expect(isPrivateDbHost(dbHostOf('postgres://u@[::ffff:10.1.2.3]/x'))).toBe(true);
    expect(isPrivateDbHost(dbHostOf('postgres://u@[::ffff:8.8.8.8]/x'))).toBe(false);
    expect(isPrivateDbHost(dbHostOf('postgres://u@[::]/x'))).toBe(true);
  });
});
