// @vitest-environment node
import { ToolMessage } from '@langchain/core/messages';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CHAT_FEATURES, toolsFor } from '@/server/chat/features/registry';

import { noticeCountTool, sampleFeature } from '../../fixtures/chat/sample-feature';
import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/** docs/chat/extending.md 4단계의 테스트 예제 — 새 기능마다 이 세 가지를 복사해 쓴다 */
let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});

describe('sample-feature (확장 가이드 예제)', () => {
  it('① 도구 단위: 입력 경계·출력 strict·금지 키 없음', async () => {
    expect(noticeCountTool.input.safeParse({ extra: 1 }).success).toBe(false);
    const result = await noticeCountTool.run(
      {},
      { db: ctx.handle.db, actor: { userId: ctx.userId, role: 'USER' } },
    );
    expect(noticeCountTool.output.safeParse(result.data).success).toBe(true);
    expect(JSON.stringify(result.data)).not.toMatch(/cost|margin|원가/i);
  });

  it('② 스크립트 모델이 새 도구를 호출하는 그래프 통합 1건', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'notice_count', args: {} }] },
      { text: '공지는 N건입니다.' },
    ]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '공지 몇 개야?', {
      features: [...CHAT_FEATURES, sampleFeature()],
    });
    expect((model.calls[1]!.messages.at(-1) as ToolMessage).status).not.toBe('error');
    expect(reply.mode).toBe('llm');
  });

  it('③ 권한 없는 역할에서 toolsFor 에 없고, 강제 호출하면 거부', async () => {
    const features = [...CHAT_FEATURES, sampleFeature('users.manage')];
    expect(toolsFor(features, { role: 'USER' }).map((tool) => tool.name)).not.toContain(
      'notice_count',
    );
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'notice_count', args: {} }] },
      { text: '끝' },
    ]);
    await ask(scriptedRuntime(ctx.handle, { model }), '공지 몇 개야?', { features, role: 'USER' });
    expect((model.calls[1]!.messages.at(-1) as ToolMessage).status).toBe('error');
  });
});
