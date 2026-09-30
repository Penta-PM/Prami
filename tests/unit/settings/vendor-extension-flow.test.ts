// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';

import { createTestDb, insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/**
 * AC-242 벤더 확장 — 등록·검증·챗봇 경로 (PGlite, node 환경). 설정 카드 렌더는 vendor-extension.test.tsx.
 * 레지스트리에 Acme AI 1줄을 더한 것 외에 앱 코드는 그대로다.
 */
vi.mock('@/server/llm/vendors/registry', async (importOriginal) =>
  (await import('../../fixtures/chat/acme-vendor')).withAcme(
    await importOriginal<typeof import('@/server/llm/vendors/registry')>(),
  ),
);

const { env } = await import('@/env');
const { keyringFromEnv } = await import('@/server/llm/credentials/keyring');
const { saveCredential } = await import('@/server/llm/credentials/service');
const { getMySettings } = await import('@/server/llm/credentials/settings');
const { runChat } = await import('@/server/chat/graph/run');
const { chatGraph, createChatRuntime } = await import('@/server/chat/graph/runtime');

let handle: DbHandle;
let userId: string;

beforeAll(async () => {
  handle = await createTestDb();
  userId = (await insertUser(handle, { email: 'acme@pentasecurity.com' })).id;
});
afterAll(async () => {
  await handle.close();
});

describe('벤더 확장 — 등록·검증·챗봇 (AC-242)', () => {
  it('등록·검증(벤더 상수 호스트) → 정상, 챗봇 경로가 추가 코드 없이 Acme 모델로 답한다', async () => {
    const ctx = {
      handle,
      actor: { id: userId, label: 'acme' },
      meta: { ip: null, userAgent: 'vitest' },
      keys: keyringFromEnv(env),
      mode: 'fake' as const,
    };
    const saved = await saveCredential(ctx, { vendor: 'acme', apiKey: makeFakeKey('fake-valid-') });
    expect(saved).toMatchObject({ vendor: 'acme', vendorLabel: 'Acme AI', status: 'valid' });
    const settings = await getMySettings({
      db: handle.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'fake',
      testMode: true,
    });
    expect(settings.credentials.map((entry) => entry.vendor)).toEqual(['acme']);
    const reply = await runChat(
      chatGraph,
      { text: 'Wapples-500 가격', truncated: false, history: [], actor: { userId, role: 'USER' } },
      createChatRuntime({ db: handle.db, userId, env }),
    );
    expect(reply).toMatchObject({ mode: 'llm', llm: { status: 'ready', vendor: 'acme' } });
  });
});
