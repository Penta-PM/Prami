// @vitest-environment node
import type { BaseMessage } from '@langchain/core/messages';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { runChat } from '@/server/chat/graph/run';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatRuntime } from '@/server/chat/graph/types';
import type { ChatModelFactoryOptions } from '@/server/llm/vendors/types';
import { defaultModelFor } from '@/server/llm/models';
import { createAnthropicChatModel } from '@/server/llm/vendors/anthropic-chat';
import { createGoogleChatModel } from '@/server/llm/vendors/google-chat';
import {
  createOpenAIChatModel,
  createOpenAICompatibleChatModel,
} from '@/server/llm/vendors/openai-chat';
import { OPENROUTER_API_BASE } from '@/server/llm/vendors/openrouter';

import { dependencies } from '../../../package.json';
import { createAnthropicStub, toolUseBlock } from '../../fixtures/chat/anthropic-http';
import { ScriptedChatModel, type ScriptStep } from '../../fixtures/chat/scripted-model';
import { createGeminiStub, createOpenAIStub } from '../../fixtures/chat/vendor-http';
import { scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-350·AC-351 결함 H-1 회귀 (PRAMI-003 §4.5.4): SSE(`streamMode` 에 `messages`)와 JSON(`invoke`) 경로에서 모델이 받는
 * 메시지 배열이 같아야 한다. 수정 전(`1605ad7`)에는 LangGraph 가 prepare 의 id 없는 메시지 전부에 같은 `run-<id>` 를 붙여
 * add-messages 리듀서가 마지막 Human 하나만 남겼다 — SSE 1회차 모델 입력 = `[human]`(시스템 프롬프트·이력 유실).
 * 테스트 이름의 버전은 package.json 고정 버전 — 이 버전을 올리는 PR 은 이 테스트를 통과해야 한다(⑤).
 */
const LANGGRAPH = `@langchain/langgraph@${dependencies['@langchain/langgraph']}`;

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => vi.unstubAllGlobals());

const HISTORY = [
  { role: 'user' as const, text: 'HIST-Q1 WAPPLES 제품군 알려줘' },
  { role: 'assistant' as const, text: 'HIST-A1 WAPPLES 는 웹 방화벽입니다.' },
];
const QUESTION = 'Wapples-500 가격';

const input = () => ({
  text: QUESTION,
  truncated: false,
  history: HISTORY,
  actor: { userId: '00000000-0000-4000-8000-00000000000a', role: 'USER' as const },
});

async function runJson(runtime: ChatRuntime) {
  return runChat(buildChatGraph(), input(), runtime);
}

async function runSse(runtime: ChatRuntime) {
  return new Response(streamChat(buildChatGraph(), input(), runtime)).text();
}

type Shape = { type: string; content: unknown; toolCalls?: string[] };

function shapeOf(messages: BaseMessage[]): Shape[] {
  return messages.map((message) => {
    const calls = (message as { tool_calls?: { name: string }[] }).tool_calls;
    return {
      type: message.getType(),
      content: message.content,
      ...(calls?.length ? { toolCalls: calls.map((call) => call.name) } : {}),
    };
  });
}

const LOOKUP = { name: 'price_lookup', args: { query: 'Wapples-500', family: null } };

/** 같은 스크립트로 JSON·SSE 를 각각 실행하고 모델 호출별 입력을 돌려준다 */
async function scriptedBoth(steps: ScriptStep[]) {
  const jsonModel = new ScriptedChatModel(steps);
  const sseModel = new ScriptedChatModel(steps);
  await runJson(scriptedRuntime(ctx.handle, { model: jsonModel }));
  await runSse(scriptedRuntime(ctx.handle, { model: sseModel }));
  return { json: jsonModel.calls, sse: sseModel.calls };
}

describe(`H-1 모델 입력 동일성 — ScriptedChatModel JSON·SSE (AC-350, ${LANGGRAPH})`, () => {
  it('이력 2턴 + 도구 1회: 1회차 [system, human, ai, human], 2회차 + [ai(tool_calls), tool] 이 두 경로에서 같다', async () => {
    const { json, sse } = await scriptedBoth([{ toolCalls: [LOOKUP] }, { text: '두 모델입니다.' }]);
    expect(json).toHaveLength(2);
    expect(sse).toHaveLength(2);
    const first = shapeOf(sse[0]!.messages);
    expect(first.map((entry) => entry.type)).toEqual(['system', 'human', 'ai', 'human']);
    expect(first[1]!.content).toBe(HISTORY[0]!.text);
    expect(first[2]!.content).toBe(HISTORY[1]!.text);
    expect(first[3]!.content).toBe(QUESTION);
    expect(shapeOf(sse[1]!.messages).map((entry) => entry.type)).toEqual([
      'system',
      'human',
      'ai',
      'human',
      'ai',
      'tool',
    ]);
    expect(shapeOf(sse[1]!.messages)[4]!.toolCalls).toEqual(['price_lookup']);
    expect(sse.map((call) => shapeOf(call.messages))).toEqual(
      json.map((call) => shapeOf(call.messages)),
    );
  });

  it('한 턴 도구 호출 2개 → ToolMessage 2개가 다음 모델 입력에 모두 있다 (JSON·SSE, AC-351)', async () => {
    const second = { name: 'price_lookup', args: { query: 'Wapples-1000', family: null } };
    const { json, sse } = await scriptedBoth([
      { toolCalls: [LOOKUP, second] },
      { text: '두 제품입니다.' },
    ]);
    for (const calls of [json, sse]) {
      const types = shapeOf(calls[1]!.messages).map((entry) => entry.type);
      expect(types).toEqual(['system', 'human', 'ai', 'human', 'ai', 'tool', 'tool']);
    }
    expect(sse.map((call) => shapeOf(call.messages))).toEqual(
      json.map((call) => shapeOf(call.messages)),
    );
  });

  it('SSE 실행 중 state.messages: id 가 모두 있고 유일하며 첫 메시지만 System — 도구 2회전 AI 메시지 2개도 별개 (AC-351 ③, H1-2)', async () => {
    const { json, sse } = await scriptedBoth([
      { toolCalls: [LOOKUP] },
      { toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples-1000', family: null } }] },
      { text: '두 모델입니다.' },
    ]);
    expect(shapeOf(sse[2]!.messages).map((entry) => entry.type)).toEqual([
      'system',
      'human',
      'ai',
      'human',
      'ai',
      'tool',
      'ai',
      'tool',
    ]);
    expect(sse.map((call) => shapeOf(call.messages))).toEqual(
      json.map((call) => shapeOf(call.messages)),
    );
    for (const call of sse) {
      const ids = call.messages.map((message) => message.id);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(call.messages[0]!.getType()).toBe('system');
      expect(call.messages.filter((message) => message.getType() === 'system')).toHaveLength(1);
    }
  });
});

const KEYS = {
  anthropic: 'sk-ant-api03-test-IDENTITY-anthropic-0000001',
  openai: 'sk-proj-test-IDENTITY-openai-000000000000002',
  openrouter: 'sk-or-v1-test-IDENTITY-openrouter-00000003',
  google: 'AIzaTestIDENTITYgoogle000000000000000004',
} as const;
type Vendor = keyof typeof KEYS;

const TURNS = [{ toolCall: LOOKUP }, { text: '두 모델이 있습니다.' }];

function stubFor(vendor: Vendor) {
  if (vendor === 'anthropic') {
    return createAnthropicStub([
      { content: [toolUseBlock('toolu_1', LOOKUP.name, LOOKUP.args)], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: '두 모델이 있습니다.' }], stop_reason: 'end_turn' },
    ]);
  }
  return vendor === 'google' ? createGeminiStub(TURNS) : createOpenAIStub(TURNS);
}

function factoryFor(vendor: Vendor, fetchImpl: typeof fetch) {
  const modelId = defaultModelFor(vendor)!;
  return (options: ChatModelFactoryOptions) => {
    const withFetch = { ...options, fetch: fetchImpl };
    if (vendor === 'anthropic') return createAnthropicChatModel(KEYS[vendor], modelId, withFetch);
    if (vendor === 'openai') return createOpenAIChatModel(KEYS[vendor], modelId, withFetch);
    if (vendor === 'google') return createGoogleChatModel(KEYS[vendor], modelId, withFetch);
    return createOpenAICompatibleChatModel(KEYS[vendor], modelId, withFetch, OPENROUTER_API_BASE);
  };
}

/** 벤더 요청 본문의 메시지 구성 (OpenAI `input`, OpenRouter `messages`, Anthropic `system`+`messages`, Gemini `systemInstruction`+`contents`) */
function conversationOf(vendor: Vendor, body: Record<string, unknown>) {
  if (vendor === 'openai') return { input: body.input };
  if (vendor === 'openrouter') return { messages: body.messages };
  if (vendor === 'anthropic') return { system: body.system, messages: body.messages };
  return { systemInstruction: body.systemInstruction, contents: body.contents };
}

async function vendorRun(vendor: Vendor, path: 'json' | 'sse') {
  const stub = stubFor(vendor);
  if (vendor === 'google') vi.stubGlobal('fetch', stub.fetch);
  const modelId = defaultModelFor(vendor)!;
  const runtime = scriptedRuntime(ctx.handle, { status: 'ready', vendor, modelId });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: factoryFor(vendor, stub.fetch),
  });
  if (path === 'json') await runJson(runtime);
  else await runSse(runtime);
  vi.unstubAllGlobals();
  return stub.requests.map((request) => conversationOf(vendor, request.body));
}

describe(`H-1 벤더 요청 본문 동일성 — 전송 가로채기 JSON·SSE (AC-350, ${LANGGRAPH})`, () => {
  it.each(['openai', 'openrouter', 'anthropic', 'google'] as const)(
    '%s: 도구 1회 다턴 요청 2건의 메시지 구성이 JSON·SSE 에서 같고 시스템 프롬프트·이력이 있다',
    async (vendor) => {
      const json = await vendorRun(vendor, 'json');
      const sse = await vendorRun(vendor, 'sse');
      expect(json).toHaveLength(2);
      expect(sse).toEqual(json);
      const first = JSON.stringify(sse[0]);
      expect(first).toContain('HIST-Q1');
      expect(first).toContain('HIST-A1');
      expect(first).toContain(QUESTION);
    },
    20_000,
  );

  it('openai: SSE 1회차 Responses input 역할 = [developer, user, assistant, user]', async () => {
    const [first] = await vendorRun('openai', 'sse');
    const roles = (first!.input as { role?: string; type?: string }[]).map(
      (item) => item.role ?? item.type,
    );
    expect(roles).toEqual(['developer', 'user', 'assistant', 'user']);
  });
});
