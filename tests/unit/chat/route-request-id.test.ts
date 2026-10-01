// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { env } from '@/env';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import { saveCredential } from '@/server/llm/credentials/service';

import { setupChatDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/**
 * AC-352 requestId 의미 복원 (PRAMI-003 §4.5.1 r2): 실제 POST /api/chat 에서 proxy 가 붙인 `x-request-id` 가
 * `chat.llm_error.requestId` 로 남는다 (JSON·SSE) — 벤더 요청 id 와 섞이지 않는다.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
}));

const { POST } = await import('@/app/api/chat/route');
const { rateLimiters } = await import('@/server/rate-limit');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userId: string;

beforeAll(async () => {
  const ctx = await setupChatDb();
  state.handle = ctx.handle;
  userId = (await insertUser(ctx.handle, { email: 'route-reqid@pentasecurity.com', role: 'USER' }))
    .id;
  await saveCredential(
    {
      handle: ctx.handle,
      actor: { id: userId, label: 'route-reqid' },
      meta: { ip: null, userAgent: 'vitest' },
      keys: keyringFromEnv(env),
      mode: 'fake',
    },
    { vendor: 'anthropic', apiKey: makeFakeKey('fake-500-') },
  );
}, 120_000);

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  rateLimiters.chat.reset();
  state.sessionUserId = userId;
});

it.each([
  ['JSON', {}, false],
  ['SSE', { accept: 'text/event-stream' }, true],
] as const)(
  '%s: x-request-id → chat.llm_error.requestId, stream 표시',
  async (_label, extra, stream) => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const requestId = `app-req-${stream ? 'sse' : 'json'}-0001`;
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId, ...extra },
        body: JSON.stringify({ message: 'Wapples-500 가격' }),
      }),
    );
    await response.text();
    spy.mockRestore();
    const entry = lines
      .filter((line) => line.includes('"event":"chat.llm_error"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)[0];
    expect(entry).toMatchObject({ code: 'unavailable', httpStatus: 500, requestId, stream });
    expect(entry?.vendorRequestId).not.toBe(requestId);
  },
);
