// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatLog, logger, MASK } from '@/server/log';
import { contextRequestId, withRequestContext } from '@/server/request-context';

const headerState = vi.hoisted(() => ({ requestId: null as string | null, fail: false }));
vi.mock('next/headers', () => ({
  headers: async () => {
    if (headerState.fail) throw new Error('outside request scope');
    return new Headers(headerState.requestId ? { 'x-request-id': headerState.requestId } : {});
  },
}));

const { inRequestScope } = await import('@/server/request-scope');

/** AC-363 (PRAMI-003 §4.3.8): 모든 구조화 로그에 release·env·requestId — 기존 마스킹은 그대로 */
describe('AC-363 로그 공통 필드', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('요청 스코프 밖: requestId 키는 항상 있고 null, release·env 는 기본값', () => {
    vi.stubEnv('APP_RELEASE', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('VERCEL_ENV', '');
    const record = formatLog('info', 'x.event');
    expect(record).toMatchObject({ release: 'dev', env: 'local', requestId: null });
    expect(Object.keys(record)).toEqual(
      expect.arrayContaining(['level', 'event', 'time', 'release', 'env', 'requestId']),
    );
  });

  it('요청 스코프 안: 필드로 넘기지 않아도 스코프의 requestId, 비동기 경계를 넘어서도 유지', async () => {
    vi.stubEnv('APP_RELEASE', 'abc1234');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const record = await withRequestContext('req-12345678', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return formatLog('warn', 'x.event', { scope: 'chat' });
    });
    expect(record).toMatchObject({
      release: 'abc1234',
      env: 'preview',
      requestId: 'req-12345678',
      scope: 'chat',
    });
    expect(contextRequestId()).toBeNull();
  });

  it('필드로 넘긴 requestId 가 스코프보다 우선, 빈 문자열은 스코프 값으로 대체', () => {
    withRequestContext('scope-id-0001', () => {
      expect(formatLog('info', 'e', { requestId: 'given-id-0001' }).requestId).toBe(
        'given-id-0001',
      );
      expect(formatLog('info', 'e', { requestId: '' }).requestId).toBe('scope-id-0001');
      expect(formatLog('info', 'e', { requestId: null }).requestId).toBe('scope-id-0001');
    });
  });

  it('logger 출력 한 줄 JSON 에 세 필드 + 마스킹 유지(비밀 키 이름·URL userinfo·Bearer)', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => lines.push(String(line)));
    withRequestContext('req-mask-0001', () =>
      logger.error('x.failed', {
        password: 'p@ss',
        url: 'postgres://user:hunter2@db.example.com/x',
        header: 'Bearer abcdefghijklmnop',
      }),
    );
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({ requestId: 'req-mask-0001', password: MASK });
    expect(record).toHaveProperty('release');
    expect(record).toHaveProperty('env');
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('abcdefghijklmnop');
  });
});

describe('inRequestScope (runAction·runRoute 경계)', () => {
  it('proxy 가 붙인 x-request-id 로 스코프를 연다', async () => {
    headerState.requestId = 'proxy-req-0001';
    headerState.fail = false;
    expect(await inRequestScope(async () => formatLog('info', 'e').requestId)).toBe(
      'proxy-req-0001',
    );
  });

  it('요청 밖(headers() 실패)이면 null', async () => {
    headerState.fail = true;
    expect(await inRequestScope(async () => formatLog('info', 'e').requestId)).toBeNull();
  });
});
