// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { maskKey } from '@/server/llm/credentials/mask';
import {
  defaultModelFor,
  intersectAvailableModels,
  isKnownModel,
  LLM_MODELS,
  modelsFor,
} from '@/server/llm/models';
import {
  assertSafeVerifyRequest,
  classifyVerifyResponse,
  MAX_MODEL_LIST_PAGES,
  UnsafeVerifyRequestError,
  verifyCredential,
} from '@/server/llm/verify';
import { anthropic } from '@/server/llm/vendors/anthropic';
import { google } from '@/server/llm/vendors/google';
import { openai } from '@/server/llm/vendors/openai';
import {
  activeVendors,
  findVendor,
  isAcceptableKey,
  LLM_VENDORS,
} from '@/server/llm/vendors/registry';

import { makeFakeKey } from '../../helpers/secret';

/** AC-207 검증(요청 빌더·판정·fake 모드), 마스킹(§4.10), 모델 상수(§4.5.2) */
describe('검증 요청 빌더 (AC-207, T-12)', () => {
  const secret = makeFakeKey('fake-valid-');

  it('벤더별 URL·헤더가 스펙 §4.6.3 과 같고 URL 에 키가 없다 (Gemini 는 x-goog-api-key 헤더)', () => {
    const a = anthropic.verifyRequest(secret);
    expect(a.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(a.headers).toEqual({ 'x-api-key': secret, 'anthropic-version': '2023-06-01' });
    const o = openai.verifyRequest(secret);
    expect(o.url).toBe('https://api.openai.com/v1/models');
    expect(o.headers).toEqual({ authorization: `Bearer ${secret}` });
    const g = google.verifyRequest(secret);
    expect(g.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(g.headers).toEqual({ 'x-goog-api-key': secret });
    for (const vendor of LLM_VENDORS) {
      const request = vendor.verifyRequest(secret);
      expect(request.url).not.toContain(secret);
      expect(() => assertSafeVerifyRequest(request, secret)).not.toThrow();
    }
  });

  it('상수 목록 밖 호스트·http·URL 속 키는 예외', () => {
    expect(() =>
      assertSafeVerifyRequest({ url: 'https://evil.example/v1/models', headers: {} }, secret),
    ).toThrow(UnsafeVerifyRequestError);
    expect(() =>
      assertSafeVerifyRequest({ url: 'http://api.openai.com/v1/models', headers: {} }, secret),
    ).toThrow(UnsafeVerifyRequestError);
    expect(() =>
      assertSafeVerifyRequest(
        {
          url: `https://generativelanguage.googleapis.com/v1beta/models?key=${secret}`,
          headers: {},
        },
        secret,
      ),
    ).toThrow(UnsafeVerifyRequestError);
    // 오류 메시지에 키가 없다
    try {
      assertSafeVerifyRequest({ url: `https://api.openai.com/?k=${secret}`, headers: {} }, secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret.slice(-12));
    }
  });
});

describe('판정 (AC-207)', () => {
  it('2xx valid / 401 invalid / Gemini 400 API_KEY_INVALID invalid / 403 forbidden / 429 rate_limited / 5xx error', () => {
    expect(classifyVerifyResponse(anthropic, 200, null)).toEqual({
      outcome: 'valid',
      errorCode: null,
      availableModels: null,
    });
    expect(classifyVerifyResponse(openai, 401, null)).toEqual({
      outcome: 'invalid',
      errorCode: 'invalid_key',
      availableModels: null,
    });
    const geminiInvalid = {
      error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
    };
    expect(classifyVerifyResponse(google, 400, geminiInvalid).outcome).toBe('invalid');
    // 같은 400 이라도 Gemini 키 오류가 아니면 확인 실패, 다른 벤더의 400 도 확인 실패
    expect(
      classifyVerifyResponse(google, 400, { error: { details: [{ reason: 'OTHER' }] } }).outcome,
    ).toBe('error');
    expect(classifyVerifyResponse(anthropic, 400, geminiInvalid).outcome).toBe('error');
    expect(classifyVerifyResponse(openai, 403, null)).toEqual({
      outcome: 'forbidden',
      errorCode: 'forbidden',
      availableModels: null,
    });
    expect(classifyVerifyResponse(openai, 429, null)).toEqual({
      outcome: 'rate_limited',
      errorCode: 'rate_limited',
      availableModels: null,
    });
    expect(classifyVerifyResponse(openai, 503, null)).toEqual({
      outcome: 'error',
      errorCode: 'unavailable',
      availableModels: null,
    });
  });

  it('live: fetch 는 상수 URL·헤더로 1회, redirect 금지, 타임아웃·네트워크 오류는 error (메시지 버림)', async () => {
    const secret = makeFakeKey('sk-ant-');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(
      verifyCredential(anthropic, secret, { mode: 'live', fetchImpl }),
    ).resolves.toMatchObject({ outcome: 'valid' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1000',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({ 'x-api-key': secret }) as unknown,
      }),
    );
    const gemini400 = vi.fn(async () =>
      Response.json({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 }),
    );
    await expect(
      verifyCredential(google, 'AIza' + 'x'.repeat(35), { mode: 'live', fetchImpl: gemini400 }),
    ).resolves.toMatchObject({ outcome: 'invalid' });
    const failing = vi.fn(async () => {
      throw new Error(`Incorrect API key provided: ${secret}`);
    });
    await expect(
      verifyCredential(openai, secret, { mode: 'live', fetchImpl: failing }),
    ).resolves.toEqual({ outcome: 'error', errorCode: 'unavailable', availableModels: null });
  });

  it.each([
    ['fake-valid-', 'valid'],
    ['fake-invalid-', 'invalid'],
    ['fake-401-', 'invalid'],
    ['fake-403-', 'forbidden'],
    ['fake-429-', 'rate_limited'],
    ['fake-500-', 'error'],
    ['fake-timeout-', 'error'],
    ['fake-echo-', 'error'],
  ])('fake 모드 %s → %s', async (prefix, outcome) => {
    await expect(
      verifyCredential(anthropic, makeFakeKey(prefix), { mode: 'fake' }),
    ).resolves.toMatchObject({ outcome });
  });

  it('fake-gemini400- 은 Google 에서만 invalid (Gemini 식 400), 다른 벤더에서는 확인 실패', async () => {
    const key = makeFakeKey('fake-gemini400-');
    await expect(verifyCredential(google, key, { mode: 'fake' })).resolves.toMatchObject({
      outcome: 'invalid',
    });
    await expect(verifyCredential(openai, key, { mode: 'fake' })).resolves.toMatchObject({
      outcome: 'error',
    });
  });
});

describe('형식·마스킹·레지스트리', () => {
  it('키 형식: 16~256자·허용 문자, live 모드는 fake- 접두 거부', () => {
    expect(isAcceptableKey(anthropic, makeFakeKey(), true)).toBe(true);
    expect(isAcceptableKey(anthropic, makeFakeKey(), false)).toBe(false);
    expect(isAcceptableKey(anthropic, 'sk-ant-short', false)).toBe(false);
    expect(isAcceptableKey(anthropic, `sk-ant-${'a'.repeat(30)}!`, false)).toBe(false);
    expect(isAcceptableKey(anthropic, `sk-ant-${'a'.repeat(300)}`, false)).toBe(false);
  });

  it('마스킹: 알려진 접두 + … + 끝 영숫자 4자 (DB CHECK 형식), 영숫자 4자 미만이면 null', () => {
    const hint = /^[A-Za-z-]{0,8}…[A-Za-z0-9]{4}$/;
    expect(maskKey(anthropic, 'sk-ant-testabcdefghijklmnopWXYZ')).toBe('sk-ant-…WXYZ');
    expect(maskKey(openai, 'sk-proj-abcdefghijklmnopqrst1234')).toBe('sk-proj-…1234');
    expect(maskKey(google, `AIza${'x'.repeat(31)}9876`)).toBe('AIza…9876');
    expect(maskKey(anthropic, 'fake-valid-abcdefghij_ab-cd.ef')).toBe('fake-…cdef');
    expect(maskKey(openai, 'plainkeywithoutprefix0000')).toBe('…0000');
    for (const key of [
      makeFakeKey(),
      makeFakeKey('fake-echo-'),
      'sk-ant-testabcdefghijklmnopWXYZ',
    ]) {
      expect(maskKey(anthropic, key)).toMatch(hint);
    }
    expect(maskKey(anthropic, '---------------_')).toBeNull();
  });

  it('레지스트리 3사 + OpenRouter(OAuth 전용·플래그), 벤더별 상수 호스트, 모델 상수 검증', () => {
    expect(LLM_VENDORS.map((vendor) => vendor.id)).toEqual([
      'anthropic',
      'openai',
      'google',
      'openrouter',
    ]);
    expect(activeVendors({ oauthOpenRouter: false }).map((vendor) => vendor.id)).toEqual([
      'anthropic',
      'openai',
      'google',
    ]);
    expect(activeVendors({ oauthOpenRouter: true }).map((vendor) => vendor.id)).toContain(
      'openrouter',
    );
    expect(findVendor('openrouter')?.authTypes).toEqual(['oauth_pkce']);
    for (const vendor of LLM_VENDORS) {
      expect(new URL(vendor.verifyRequest('k'.repeat(20)).url).hostname).toBe(vendor.host);
      expect(vendor.createChatModel).toBeTypeOf('function');
    }
    // 다른 벤더 호스트로의 요청은 이 벤더에서 거부 (벤더별 상수 호스트)
    expect(() =>
      assertSafeVerifyRequest(
        { url: 'https://api.openai.com/v1/models', headers: {} },
        'secret-x',
        ['api.anthropic.com'],
      ),
    ).toThrow(UnsafeVerifyRequestError);
    expect(isKnownModel('anthropic', LLM_MODELS.anthropic[0].id)).toBe(true);
    expect(isKnownModel('anthropic', 'gpt-6.1-sol')).toBe(false);
    expect(isKnownModel('nope', 'x')).toBe(false);
  });
});

describe('사용 가능 모델 = 목록 ∩ 상수 (AC-207 ⑦, r2)', () => {
  const ids = (vendor: string) => modelsFor(vendor).map((model) => model.id);

  it('정규화: Anthropic 날짜 스냅샷·Gemini models/ 접두를 떼고, 상수 밖 ID 는 버리며 상수 순서를 따른다', () => {
    expect(
      intersectAvailableModels('anthropic', [
        'claude-sonnet-5',
        'claude-haiku-4-5-20251001',
        'claude-opus-5-5',
        'claude-3-legacy-x',
      ]),
    ).toEqual(['claude-opus-5-5', 'claude-haiku-4-5', 'claude-sonnet-5']);
    expect(
      intersectAvailableModels('google', ['models/gemini-3.5-flash-lite', 'models/embedding-x']),
    ).toEqual(['gemini-3.5-flash-lite']);
    expect(intersectAvailableModels('openai', [])).toEqual([]);
    expect(intersectAvailableModels('nope', ['x'])).toEqual([]);
  });

  it.each([
    ['anthropic', anthropic],
    ['openai', openai],
    ['google', google],
  ] as const)(
    '%s: fake-valid 전부, fake-partial 기본 모델만, fake-paged 2페이지 합산',
    async (id, vendor) => {
      const run = (prefix: string) =>
        verifyCredential(vendor, makeFakeKey(prefix), { mode: 'fake' });
      await expect(run('fake-valid-')).resolves.toEqual({
        outcome: 'valid',
        errorCode: null,
        availableModels: ids(id),
      });
      await expect(run('fake-partial-')).resolves.toMatchObject({
        outcome: 'valid',
        availableModels: [defaultModelFor(id)],
      });
      await expect(run('fake-paged-')).resolves.toMatchObject({ availableModels: ids(id) });
    },
  );

  it('목록 호출 실패는 정상이지만 NULL(미확인): 다음 페이지 500·목록 형식 아님, 비정상 판정도 NULL', async () => {
    for (const prefix of ['fake-pagefail-', 'fake-nolist-']) {
      await expect(
        verifyCredential(google, makeFakeKey(prefix), { mode: 'fake' }),
      ).resolves.toEqual({
        outcome: 'valid',
        errorCode: null,
        availableModels: null,
      });
    }
    for (const prefix of [
      'fake-invalid-',
      'fake-403-',
      'fake-429-',
      'fake-500-',
      'fake-timeout-',
    ]) {
      await expect(
        verifyCredential(anthropic, makeFakeKey(prefix), { mode: 'fake' }),
      ).resolves.toMatchObject({ availableModels: null });
    }
  });

  it(`live: 다음 페이지는 커서를 붙인 상수 URL 로 요청(키는 헤더), ${MAX_MODEL_LIST_PAGES}페이지를 넘으면 NULL`, async () => {
    const secret = makeFakeKey('AIza');
    const urls: string[] = [];
    const endless = vi.fn(async (url: string) => {
      urls.push(url);
      return Response.json({
        models: [{ name: 'models/gemini-3.8-flash' }],
        nextPageToken: `t${urls.length}`,
      });
    });
    await expect(
      verifyCredential(google, secret, {
        mode: 'live',
        fetchImpl: endless as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      outcome: 'valid',
      errorCode: null,
      availableModels: null,
    });
    expect(urls).toHaveLength(MAX_MODEL_LIST_PAGES);
    expect(urls[1]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=t1',
    );
    for (const url of urls) expect(url).not.toContain(secret);
    const twoPages = vi.fn(async (url: string) =>
      Response.json(
        url.includes('after_id')
          ? { data: [{ id: 'claude-sonnet-5-5' }], has_more: false }
          : { data: [{ id: 'claude-opus-5-5' }], has_more: true, last_id: 'claude-opus-5-5' },
      ),
    );
    await expect(
      verifyCredential(anthropic, makeFakeKey('sk-ant-'), {
        mode: 'live',
        fetchImpl: twoPages as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ availableModels: ['claude-opus-5-5', 'claude-sonnet-5-5'] });
    expect(twoPages).toHaveBeenLastCalledWith(
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5',
      expect.anything(),
    );
  });

  it('모델 상수: Anthropic 기본 claude-opus-5-5, 레거시 2종, 벤더당 기본 1개, 날짜 접미사 없음', () => {
    expect(defaultModelFor('anthropic')).toBe('claude-opus-5-5');
    expect(
      LLM_MODELS.anthropic.filter((model) => model.lifecycle === 'legacy').map((model) => model.id),
    ).toEqual(['claude-opus-5', 'claude-sonnet-5']);
    for (const models of Object.values(LLM_MODELS)) {
      const list: readonly { id: string; lifecycle: string; isDefault?: true }[] = models;
      expect(list.filter((model) => model.isDefault)).toHaveLength(1);
      expect(list.find((model) => model.isDefault)?.lifecycle).toBe('current');
      for (const model of list) expect(model.id).not.toMatch(/-\d{8}$/);
    }
  });
});
