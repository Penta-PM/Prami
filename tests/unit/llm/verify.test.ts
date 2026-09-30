// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { maskKey } from '@/server/llm/credentials/mask';
import { isKnownModel, LLM_MODELS } from '@/server/llm/models';
import {
  assertSafeVerifyRequest,
  classifyVerifyResponse,
  UnsafeVerifyRequestError,
  verifyCredential,
} from '@/server/llm/verify';
import { anthropic } from '@/server/llm/vendors/anthropic';
import { google } from '@/server/llm/vendors/google';
import { openai } from '@/server/llm/vendors/openai';
import { findVendor, isAcceptableKey, LLM_VENDORS } from '@/server/llm/vendors/registry';

import { makeFakeKey } from '../../helpers/secret';

/** AC-207 검증(요청 빌더·판정·fake 모드), 마스킹(§4.10), 모델 상수(§4.5.2) */
describe('검증 요청 빌더 (AC-207, T-12)', () => {
  const secret = makeFakeKey('fake-valid-');

  it('벤더별 URL·헤더가 스펙 §4.6.3 과 같고 URL 에 키가 없다 (Gemini 는 x-goog-api-key 헤더)', () => {
    const a = anthropic.verifyRequest(secret);
    expect(a.url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(a.headers).toEqual({ 'x-api-key': secret, 'anthropic-version': '2023-06-01' });
    const o = openai.verifyRequest(secret);
    expect(o.url).toBe('https://api.openai.com/v1/models');
    expect(o.headers).toEqual({ authorization: `Bearer ${secret}` });
    const g = google.verifyRequest(secret);
    expect(g.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1');
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
    });
    expect(classifyVerifyResponse(openai, 401, null)).toEqual({
      outcome: 'invalid',
      errorCode: 'invalid_key',
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
    });
    expect(classifyVerifyResponse(openai, 429, null)).toEqual({
      outcome: 'rate_limited',
      errorCode: 'rate_limited',
    });
    expect(classifyVerifyResponse(openai, 503, null)).toEqual({
      outcome: 'error',
      errorCode: 'unavailable',
    });
  });

  it('live: fetch 는 상수 URL·헤더로 1회, redirect 금지, 타임아웃·네트워크 오류는 error (메시지 버림)', async () => {
    const secret = makeFakeKey('sk-ant-');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(
      verifyCredential(anthropic, secret, { mode: 'live', fetchImpl }),
    ).resolves.toMatchObject({ outcome: 'valid' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1',
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
    ).resolves.toEqual({ outcome: 'error', errorCode: 'unavailable' });
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

  it('레지스트리 3사, 모델 상수 검증', () => {
    expect(LLM_VENDORS.map((vendor) => vendor.id)).toEqual(['anthropic', 'openai', 'google']);
    expect(findVendor('openrouter')).toBeUndefined();
    expect(isKnownModel('anthropic', LLM_MODELS.anthropic[0].id)).toBe(true);
    expect(isKnownModel('anthropic', 'gpt-6.1-sol')).toBe(false);
    expect(isKnownModel('nope', 'x')).toBe(false);
  });
});
