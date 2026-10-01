// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env } from '@/env';
import { queryRows } from '@/server/imports/sql-rows';
import { resolveChatCredential } from '@/server/llm/credentials/chat';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import { maskKey } from '@/server/llm/credentials/mask';
import {
  saveCredential,
  verifyOwnCredential,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { updateChatDefaults } from '@/server/llm/credentials/settings';
import { adapterOf } from '@/server/llm/error-diagnostics';
import { normalizeLlmError } from '@/server/llm/errors';
import { defaultModelFor, LLM_MODELS, modelsFor } from '@/server/llm/models';
import { rateLimiters } from '@/server/rate-limit';
import { classifyVerifyResponse, verifyCredential } from '@/server/llm/verify';
import { isAcceptableKey } from '@/server/llm/vendors/registry';
import { xai } from '@/server/llm/vendors/xai';
import { withXaiErrorBody } from '@/server/llm/vendors/xai-chat';

import { createXaiStub } from '../../fixtures/chat/xai-http';
import { setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';
import { expectNoSecret, makeFakeKey } from '../../helpers/secret';

/**
 * PRAMI-003 §4.7 xAI 등록·검증·모델 상수 (AC-355·AC-357). 실벤더 호출 0 — 검증은 fake 모드·주입 fetch, 채팅은 전송 가로채기.
 */
const ROOT = process.cwd();
const RETIRED_IDS = [
  'grok-3',
  'grok-3-fast',
  'grok-4-0709',
  'grok-4-fast-reasoning',
  'grok-4-fast-non-reasoning',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-code-fast-1',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('모델 상수·출처 (AC-355)', () => {
  it('xAI 상수는 grok-4.7(기본)·grok-4.3 만, 추론 여유 8192', () => {
    expect(LLM_MODELS.xai.map((model) => model.id)).toEqual(['grok-4.7', 'grok-4.3']);
    expect(defaultModelFor('xai')).toBe('grok-4.7');
    expect(modelsFor('xai').map((model) => [model.tier, model.lifecycle])).toEqual([
      ['balanced', 'current'],
      ['low', 'current'],
    ]);
    expect(modelsFor('xai').every((model) => model.reasoningReserveTokens === 8192)).toBe(true);
  });

  it('퇴역 xAI 모델 ID·@langchain/xai 가 src/ 에 없다', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src')).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const hits = RETIRED_IDS.filter((id) => new RegExp(`['"\`]${id}['"\`]`).test(text));
      if (/from\s+['"]@langchain\/xai['"]/.test(text)) hits.push('@langchain/xai import');
      return hits.map((hit) => `${path.relative(ROOT, file)}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });

  it('models.ts 머리 주석에 xAI 출처 URL·확인일(2026-10-01)', () => {
    const text = readFileSync(path.join(ROOT, 'src/server/llm/models.ts'), 'utf8');
    for (const url of [
      'https://docs.x.ai/developers/models',
      'https://docs.x.ai/developers/grok-4-7',
      'https://docs.x.ai/developers/migration/may-15-retirement',
      'https://docs.x.ai/developers/rest-api-reference/inference/responses',
    ]) {
      expect(text).toContain(url);
    }
    expect(text).toMatch(/xAI\(PRAMI-003 PR-1c, 2026-10-01 확인\)/);
  });

  it('진단 adapter = @langchain/openai@<고정 버전>', () => {
    expect(adapterOf('xai')).toBe(adapterOf('openai'));
    expect(adapterOf('xai')).toMatch(/^@langchain\/openai@\d+\.\d+\.\d+$/);
  });
});

describe('검증 요청·판정 (AC-357)', () => {
  const secret = 'xai-test-PRAMI003-verify-000000000000000001';

  it('GET https://api.x.ai/v1/models + Bearer 헤더, URL 에 키 없음', () => {
    const request = xai.verifyRequest(secret);
    expect(request).toEqual({
      url: 'https://api.x.ai/v1/models',
      headers: { authorization: `Bearer ${secret}` },
    });
    expectNoSecret(request.url, secret, '검증 URL');
  });

  it.each([
    [200, { data: [{ id: 'grok-4.7' }] }, 'valid'],
    [400, { code: 'invalid-argument', error: 'MARKER' }, 'invalid'],
    [400, { code: 'something-else' }, 'error'],
    [401, { code: 'unauthenticated:no-credentials' }, 'invalid'],
    [403, {}, 'forbidden'],
    [429, {}, 'rate_limited'],
    [500, {}, 'error'],
    [503, {}, 'error'],
  ] as const)('%d %j → %s', (status, body, outcome) => {
    expect(classifyVerifyResponse(xai, status, body).outcome).toBe(outcome);
  });

  it('2xx 목록에 grok-4.7 만 → availableModels=[grok-4.7], 목록 밖 모델·퇴역 ID 는 무시', async () => {
    const stub = async () =>
      Response.json({ data: [{ id: 'grok-4.7' }, { id: 'grok-3' }, { id: 'grok-imagine' }] });
    const result = await verifyCredential(xai, secret, {
      mode: 'live',
      fetchImpl: stub as unknown as typeof fetch,
    });
    expect(result).toEqual({ outcome: 'valid', errorCode: null, availableModels: ['grok-4.7'] });
  });

  it('검증 요청은 api.x.ai 만 — 헤더에 키, URL·본문 없음 (주입 fetch 로 관찰)', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const stub = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return Response.json({ data: [] });
    };
    await verifyCredential(xai, secret, { mode: 'live', fetchImpl: stub as typeof fetch });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]!.url).hostname).toBe('api.x.ai');
    expect(seen[0]!.init?.method).toBe('GET');
    expect(seen[0]!.init?.body).toBeUndefined();
    expectNoSecret(seen[0]!.url, secret, 'URL');
  });

  it('타임아웃·네트워크 → error(unavailable)', async () => {
    const timeout = async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    };
    const network = async () => {
      throw new TypeError('fetch failed');
    };
    for (const fetchImpl of [timeout, network]) {
      expect(
        await verifyCredential(xai, secret, {
          mode: 'live',
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).toMatchObject({ outcome: 'error', errorCode: 'unavailable' });
    }
  });
});

describe('키 형식·마스킹 (AC-357)', () => {
  it('xai- 접두 키 힌트는 xai-…<끝 4자>, 접두 없는 16자 이상 키도 형식 통과(더미 값)', () => {
    const prefixed = 'xai-dummyPRAMI003abcdWXYZ';
    expect(maskKey(xai, prefixed)).toBe('xai-…WXYZ');
    expect(isAcceptableKey(xai, prefixed, false)).toBe(true);
    const bare = 'DummyNoPrefixKey0001';
    expect(isAcceptableKey(xai, bare, false)).toBe(true);
    expect(maskKey(xai, bare)).toBe('…0001');
    expect(isAcceptableKey(xai, 'short-key', false)).toBe(false);
    expect(isAcceptableKey(xai, 'xai-has space in key 0001', false)).toBe(false);
    expect(isAcceptableKey(xai, 'fake-valid-0000000000001', false)).toBe(false);
  });
});

describe('등록·검증 서비스 + 챗봇 기본값 (AC-357)', () => {
  let ctx: ChatTestDb;
  let userId: string;
  const credentialsCtx = (): CredentialsContext => ({
    handle: ctx.handle,
    actor: { id: userId, label: 'xai-test' },
    meta: { ip: null, userAgent: 'vitest' },
    keys: keyringFromEnv(env),
    mode: 'fake',
  });
  const verifyAudits = async () =>
    (
      await queryRows<{ n: number }>(
        ctx.handle.db,
        sql`select count(*)::int n from audit_logs where action = 'settings.llm_credential.verify' and actor_user_id = ${userId}`,
      )
    )[0]!.n;

  beforeAll(async () => {
    ctx = await setupChatDb();
    userId = (await insertUser(ctx.handle, { email: 'xai-user@pentasecurity.com' })).id;
  }, 120_000);
  afterAll(async () => {
    await ctx.handle.close();
  });
  beforeEach(() => {
    rateLimiters.llmVerify.reset();
    rateLimiters.llmVerify.configure(1000);
  });

  it.each([
    ['fake-partial-', 'valid', null, ['grok-4.7']],
    ['fake-xai400-', 'invalid', 'invalid_key', null],
    ['fake-401-', 'invalid', 'invalid_key', null],
    ['fake-403-', 'forbidden', 'forbidden', null],
    ['fake-429-', 'rate_limited', 'rate_limited', null],
    ['fake-500-', 'unverified', 'unavailable', null],
    ['fake-timeout-', 'unverified', 'unavailable', null],
  ] as const)(
    '%s → 상태 %s · last_error_code %s · 감사 verify 1행',
    async (prefix, status, code, available) => {
      const apiKey = makeFakeKey(prefix);
      const saved = await saveCredential(credentialsCtx(), { vendor: 'xai', apiKey });
      expect(saved).toMatchObject({ vendor: 'xai', status, lastErrorCode: code });
      const before = await verifyAudits();
      const verified = await verifyOwnCredential(credentialsCtx(), { vendor: 'xai' });
      expect(verified).toMatchObject({ status, lastErrorCode: code });
      if (available) expect(verified.availableModels).toEqual(available);
      expect(await verifyAudits()).toBe(before + 1);
      expectNoSecret(JSON.stringify(verified), apiKey, '검증 결과');
    },
  );

  it('챗봇 기본값 xAI·grok-4.3 저장 → 다음 질문의 모델이 xAI 어댑터(api.x.ai/v1/responses, grok-4.3)로 간다', async () => {
    await saveCredential(credentialsCtx(), { vendor: 'xai', apiKey: makeFakeKey('fake-valid-') });
    await updateChatDefaults(credentialsCtx(), { vendor: 'xai', model: 'grok-4.3' });
    const resolved = await resolveChatCredential({
      db: ctx.handle.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'live',
    });
    expect(resolved).toMatchObject({
      status: 'ready',
      vendor: 'xai',
      vendorLabel: 'xAI (Grok)',
      model: 'grok-4.3',
    });
    const stub = createXaiStub([{ text: '안녕하세요' }]);
    const model = resolved.createModel!({ maxTokens: 1024, timeoutMs: 5_000, fetch: stub.fetch });
    await model.invoke('ping');
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.url).toBe('https://api.x.ai/v1/responses');
    expect(stub.requests[0]!.body.model).toBe('grok-4.3');
  });
});

describe('xAI 오류 본문 정규화 withXaiErrorBody (§4.7.5)', () => {
  const KEY = 'xai-test-PRAMI003-wrapper-0000000000000009';
  const wrap = (response: Response) =>
    withXaiErrorBody((async () => response) as unknown as typeof fetch)(
      'https://api.x.ai/v1/responses',
    );

  it('JSON 오류: code 만 남기고 사람용 메시지는 버린다, 상태·요청 id 헤더 유지', async () => {
    const response = await wrap(
      Response.json(
        { code: 'invalid-argument', error: `MARKER ${KEY}` },
        { status: 400, headers: { 'x-request-id': 'req_xai_1' } },
      ),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('req_xai_1');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'invalid-argument' } });
    expectNoSecret(text, KEY, '정규화 본문');
  });

  it('JSON 이 아닌 오류(text/plain·HTML 502)도 본문을 버리고 빈 오류 객체로', async () => {
    for (const contentType of ['text/plain', 'text/html', '']) {
      const response = await wrap(
        new Response(`incorrect API key supplied: ${KEY}`, {
          status: 502,
          headers: contentType ? { 'content-type': contentType } : {},
        }),
      );
      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toBe('application/json');
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: {} });
      expectNoSecret(text, KEY, `${contentType || '헤더 없음'} 본문`);
    }
  });

  it('2xx·본문 없는 상태(304)는 그대로 통과', async () => {
    const ok = Response.json({ id: 'resp_1' });
    expect(await wrap(ok)).toBe(ok);
    const notModified = new Response(null, { status: 304 });
    expect(await wrap(notModified)).toBe(notModified);
  });

  it('415 → request_rejected (§4.7.5 어댑터 결함 신호)', () => {
    expect(normalizeLlmError({ status: 415 })).toBe('request_rejected');
  });
});
