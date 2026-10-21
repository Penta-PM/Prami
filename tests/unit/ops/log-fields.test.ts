// @vitest-environment node
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatLog, logger, MASK, summarizeQueryError } from '@/server/log';
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
        // 저장소 secret-scan 이 자격 증명 URL 리터럴을 막으므로 실행 시 조립한다
        url: ['postgres://user', 'hunter2@db.example.com/x'].join(':'),
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

/** BL-1: 원가 비중 실패 로그 축소 — DB 오류는 코드·메시지 첫 줄만, SQL 원문·바인딩 값 없음 */
describe('summarizeQueryError', () => {
  const SQL_TEXT =
    'select "unit_cost" from "material_costs" where "material_code" in ($1, $2) and "unit_cost" >= $3';
  const PARAMS = ['W1001010015', 'W1001010016', 1234567];

  it('drizzle 오류(Failed query + params) → cause 의 코드·첫 줄만, SQL·값 없음', () => {
    const cause = Object.assign(
      new Error('relation "cost_item_links" does not exist\nLINE 1: select ...'),
      {
        code: '42P01',
      },
    );
    const error = new DrizzleQueryError(SQL_TEXT, PARAMS, cause);
    expect(error.message).toContain('W1001010015'); // 재현 조건: 원래 메시지엔 값이 실린다
    const summary = summarizeQueryError(error);
    expect(summary).toEqual({
      code: '42P01',
      message: 'relation "cost_item_links" does not exist',
    });
    const line = JSON.stringify(
      formatLog('error', 'pricing.cost_ratio_failed', { target: 'getCostRatios', ...summary }),
    );
    for (const leaked of [
      'W1001010015',
      '1234567',
      'material_costs',
      'select',
      'params',
      'Failed query',
      'LINE 1',
    ])
      expect(line).not.toContain(leaked);
    expect(line).toContain('42P01');
    expect(line).toContain('getCostRatios');
  });

  it('cause 가 없으면 바깥 메시지에서 Failed query·params 이후를 자른다 (빈 줄이면 오류 이름)', () => {
    const error = new DrizzleQueryError(SQL_TEXT, PARAMS);
    expect(summarizeQueryError(error)).toEqual({ code: null, message: 'Error' });
    expect(summarizeQueryError(new Error('boom params: [W1001010015]'))).toEqual({
      code: null,
      message: 'boom',
    });
  });

  it('값이 섞인 pg 메시지의 숫자열(금액·자재번호)은 # 로, 코드는 SQLSTATE 형식만', () => {
    const cause = Object.assign(new Error('invalid input syntax for type numeric: "1234567"'), {
      code: '22P02',
    });
    expect(summarizeQueryError({ cause })).toEqual({
      code: '22P02',
      message: 'invalid input syntax for type numeric: "#"',
    });
    expect(
      summarizeQueryError(Object.assign(new Error('key W1001010015 exists'), { code: { x: 1 } })),
    ).toEqual({ code: null, message: 'key W# exists' });
    expect(summarizeQueryError('not an error')).toEqual({ code: null, message: 'string' });
  });
});
