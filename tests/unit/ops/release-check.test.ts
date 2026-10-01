// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  checkEnvNames,
  ENV_RULES,
  formatRows,
  parseReleaseCheckArgs,
  parseVercelEnvNames,
  runReleaseCheck,
  type ReleaseCheckDeps,
} from '@/server/ops/release-check';
import { STATIC_SECURITY_HEADERS } from '@/server/security/headers';

/** AC-365 `pnpm release:check env|schema|data|headers` — 판정·종료 코드·출력에 비밀값 없음 */
const SECRET_VALUE = 'super-secret-value-should-not-print';

const goodPage = () => {
  const headers = new Headers(
    STATIC_SECURITY_HEADERS.map(({ key, value }): [string, string] => [key, value]),
  );
  headers.set(
    'content-security-policy',
    "script-src 'self' 'nonce-abc' 'strict-dynamic'; frame-ancestors 'none'",
  );
  return new Response('<script nonce="abc"></script>', { headers });
};

function deps(overrides: Partial<ReleaseCheckDeps> = {}): ReleaseCheckDeps {
  return {
    envNames: async () => new Set(ENV_RULES.local.required),
    schemaState: async () => 'ok',
    dataVerify: async () => 0,
    fetch: async () => goodPage(),
    defaultUrl: () => 'http://localhost:3999',
    ...overrides,
  };
}

const run = (argv: string[], overrides?: Partial<ReleaseCheckDeps>) =>
  runReleaseCheck(parseReleaseCheckArgs(argv), deps(overrides));

describe('parseReleaseCheckArgs', () => {
  it('하위 명령·대상 검증, 기본 대상은 local', () => {
    expect(parseReleaseCheckArgs(['env'])).toEqual({ command: 'env', target: 'local' });
    expect(
      parseReleaseCheckArgs(['data', '--target', 'preview', '--target-host', 'ep-x.neon.tech']),
    ).toEqual({ command: 'data', target: 'preview', targetHost: 'ep-x.neon.tech' });
    expect(() => parseReleaseCheckArgs(['deploy'])).toThrow(/env\|schema\|data\|headers/);
    expect(() => parseReleaseCheckArgs(['env', '--target', 'staging'])).toThrow(/--target/);
    // 셸로 넘어가는 값 — 호스트 이름 문자만
    for (const bad of ['h; rm -rf /', 'h && echo', '$(id)', '-x', 'h|x']) {
      expect(() => parseReleaseCheckArgs(['data', '--target-host', bad])).toThrow(/--target-host/);
    }
  });
});

describe('env (C-3)', () => {
  const production = new Set([
    ...ENV_RULES.production.required,
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ]);

  it('production 필수 키가 다 있고 금지 키가 없으면 통과', () => {
    expect(checkEnvNames('production', production).every((row) => row.ok)).toBe(true);
  });

  it('누락·금지 키를 항목으로 보고한다 (테스트 모드·시드·DATABASE_URL_UNPOOLED·preview 프록시)', () => {
    const names = new Set([
      ...production,
      'AUTH_TEST_MODE',
      'PRAMI_ALLOW_SEED',
      'DATABASE_URL_UNPOOLED',
      'AUTH_REDIRECT_PROXY_URL',
    ]);
    names.delete('AUTH_SECRET');
    const failed = checkEnvNames('production', names)
      .filter((row) => !row.ok)
      .map((row) => row.item);
    expect(failed).toEqual([
      '필수 AUTH_SECRET',
      '금지 AUTH_TEST_MODE',
      '금지 PRAMI_ALLOW_SEED',
      '금지 DATABASE_URL_UNPOOLED',
      '금지 AUTH_REDIRECT_PROXY_URL',
    ]);
  });

  it('memory 위험 수용 키가 있으면 Upstash 키를 요구하지 않는다', () => {
    const names = new Set([...ENV_RULES.preview.required, 'RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION']);
    expect(checkEnvNames('preview', names).every((row) => row.ok)).toBe(true);
    names.delete('RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION');
    expect(
      checkEnvNames('preview', names)
        .filter((row) => !row.ok)
        .map((row) => row.item),
    ).toEqual(['필수 UPSTASH_REDIS_REST_URL', '필수 UPSTASH_REDIS_REST_TOKEN']);
  });

  it('preview 는 AUTH_URL 금지·프록시 필수, local 은 PRAMI_ALLOW_SEED 금지', () => {
    expect(ENV_RULES.preview.forbidden).toContain('AUTH_URL');
    expect(ENV_RULES.preview.required).toContain('AUTH_REDIRECT_PROXY_URL');
    const local = checkEnvNames(
      'local',
      new Set([...ENV_RULES.local.required, 'PRAMI_ALLOW_SEED']),
    );
    expect(local.filter((row) => !row.ok).map((row) => row.item)).toEqual([
      '금지 PRAMI_ALLOW_SEED',
    ]);
  });

  it('vercel env ls 출력에서 이름만 뽑는다 (헤더·안내 줄 제외)', () => {
    const output = [
      'Vercel CLI 62.1.0',
      '> Environment Variables found for team/prami [200ms]',
      '',
      ' name                 value               environments        created',
      ' AUTH_SECRET          Encrypted           Production          2d ago',
      ' DATABASE_URL         Encrypted           Production          2d ago',
      ' NAME x',
    ].join('\n');
    expect([...parseVercelEnvNames(output)].sort()).toEqual(['AUTH_SECRET', 'DATABASE_URL']);
  });

  it('runReleaseCheck env: 실패하면 ok=false, 출력은 이름뿐', async () => {
    const result = await run(['env', '--target', 'local'], {
      envNames: async () => new Set(['NEXT_PUBLIC_APP_URL']),
    });
    expect(result.ok).toBe(false);
    const text = formatRows('env', result.rows);
    expect(text).toContain('| FAIL | 필수 AUTH_SECRET | 있음 | 없음 |');
    expect(text).not.toContain(SECRET_VALUE);
  });
});

describe('schema (C-5)', () => {
  it('직접 연결 DB: ok 면 통과, behind 면 실패', async () => {
    expect((await run(['schema'])).ok).toBe(true);
    expect((await run(['schema'], { schemaState: async () => 'behind' })).rows[0]).toMatchObject({
      actual: 'behind',
      ok: false,
    });
  });

  it('preview·production 은 --url 필수 (직접 연결 DB 로 판정하지 않는다)', async () => {
    const schemaState = vi.fn(async () => 'ok');
    const result = await run(['schema', '--target', 'production'], { schemaState });
    expect(result.ok).toBe(false);
    expect(schemaState).not.toHaveBeenCalled();
  });

  it('--url: 앱 헬스의 schema 필드, JSON 이 아니면 HTTP 상태로 실패', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, schema: 'ok' }));
    expect((await run(['schema', '--url', 'https://p.example/'], { fetch })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://p.example/api/health', { redirect: 'manual' });
    const broken = await run(['schema', '--url', 'https://p.example'], {
      fetch: async () => new Response('<html>', { status: 502 }),
    });
    expect(broken.rows[0]).toMatchObject({ actual: 'HTTP 502', ok: false });
    const hostile = await run(['schema', '--url', 'https://p.example'], {
      fetch: async () => Response.json({ schema: 'ok | injected\n| PASS |' }),
    });
    expect(hostile.rows[0]).toMatchObject({ actual: 'unexpected', ok: false });
  });

  it('DB 연결 오류는 오류 이름만 남긴다 (연결 문자열 비노출)', async () => {
    const result = await run(['schema'], {
      schemaState: async () => {
        throw new Error(`connect failed postgres://u:${SECRET_VALUE}@h/db`);
      },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
    expect(result.rows[0]!.actual).toBe('실패 (Error)');
  });
});

describe('data (C-7·C-8)', () => {
  it('data:verify 종료 코드 그대로 판정, 인자 전달', async () => {
    const dataVerify = vi.fn(async () => 0);
    expect((await run(['data', '--target', 'local'], { dataVerify })).ok).toBe(true);
    expect(dataVerify).toHaveBeenCalledWith({ command: 'data', target: 'local' });
    expect((await run(['data'], { dataVerify: async () => 2 })).rows[0]).toMatchObject({
      actual: 'exit 2',
      ok: false,
    });
  });
});

describe('headers (C-9)', () => {
  it('기본 URL(NEXT_PUBLIC_APP_URL)의 /login 보안 헤더 6종 + nonce', async () => {
    const fetch = vi.fn(async () => goodPage());
    const result = await run(['headers'], { fetch });
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('http://localhost:3999/login', { redirect: 'manual' });
  });

  it('헤더가 빠지면 실패 항목에 헤더 이름', async () => {
    const result = await run(['headers', '--url', 'https://p.example'], {
      fetch: async () => new Response('<html>'),
    });
    expect(result.ok).toBe(false);
    expect(result.rows[0]!.actual).toContain('X-Frame-Options 없음');
  });

  it('대상 URL 이 없으면 실패', async () => {
    expect((await run(['headers'], { defaultUrl: () => undefined })).ok).toBe(false);
  });
});
