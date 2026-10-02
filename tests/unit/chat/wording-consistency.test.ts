// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyResultMessage } from '@/features/settings/labels';
import {
  LLM_ERROR_NOTICE,
  MISSING_MESSAGE,
  setupFor,
  TRUNCATED_OUTPUT_NOTICE,
} from '@/server/chat/graph/messages';
import { chatStatus } from '@/server/chat/graph/runtime';
import type { SetupStatus } from '@/server/chat/graph/types';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';

import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-367 문구 정합 (PRAMI-003 §4.5.2): PRAMI-002 §4.9(챗봇)·§4.9.1(설정) 표의 코드별 문구를 표 원문 그대로 고정하고,
 * 챗봇 `setup.message`·`/api/chat/status`(chatStatus)·설정 검증 결과가 같은 문구 원천을 쓰는지 본다.
 * 예외(r2): `missing` = §4.8.2 ③ 문구, notice `truncated_output` = §4.5.5 L-1 문구.
 */
const VENDOR = 'OpenAI';
const MODEL = 'GPT-6.1 Sol';

/** PRAMI-002 §4.9 표 (r2 missing 대체) — `{벤더}`·`{모델}` 치환 후 */
const CHAT_TABLE: Record<SetupStatus, string> = {
  missing:
    'LLM API 키가 등록되지 않았습니다. 사용자 설정에서 회사에서 발급한 Anthropic·OpenAI·Google·xAI 중 하나의 API 키를 등록하면 자연어로 질문할 수 있어요. 개인 API 키는 입력한 데이터가 모델 학습에 활용될 수 있으니 사용하지 마세요. 지금은 기본 응답으로 답해 드립니다.',
  invalid: `등록된 ${VENDOR} API 키가 유효하지 않거나 만료되었습니다. 사용자 설정에서 키를 교체해주세요.`,
  forbidden: `${VENDOR} 키에 이 요청을 수행할 권한이 없습니다. 벤더 콘솔의 키 권한 또는 사용자 설정의 모델을 확인해주세요.`,
  unreadable: `저장된 ${VENDOR} 키를 읽을 수 없습니다. 사용자 설정에서 다시 등록해주세요.`,
  model_not_found: `선택한 모델(${MODEL})을 사용할 수 없습니다. 사용자 설정에서 모델을 변경해주세요.`,
  rate_limited: `${VENDOR} 사용 한도(요청 수 또는 크레딧)를 초과했습니다. 잠시 후 다시 시도하거나 벤더 콘솔에서 한도를 확인해주세요. 이번 답변은 기본 응답입니다.`,
  unavailable: `${VENDOR} 응답이 지연되고 있습니다. 이번 답변은 기본 응답입니다.`,
};

/** PRAMI-002 §4.9.1 표 — 화면은 앞에 벤더 라벨을 붙인다 */
const SETTINGS_TABLE: Array<
  [
    label: string,
    view: Parameters<typeof verifyResultMessage>[0],
    kind: 'save' | 'verify',
    text: string,
    tone: 'ok' | 'error',
  ]
> = [
  [
    'valid 저장',
    { vendorLabel: VENDOR, status: 'valid', lastErrorCode: null },
    'save',
    '키를 저장하고 검증했습니다',
    'ok',
  ],
  [
    'valid 수동',
    { vendorLabel: VENDOR, status: 'valid', lastErrorCode: null },
    'verify',
    '키 검증을 마쳤습니다 — 정상',
    'ok',
  ],
  [
    'invalid',
    { vendorLabel: VENDOR, status: 'invalid', lastErrorCode: 'invalid_key' },
    'save',
    '저장했지만 사용할 수 없습니다: 키가 유효하지 않거나 만료되었습니다',
    'error',
  ],
  [
    'forbidden',
    { vendorLabel: VENDOR, status: 'forbidden', lastErrorCode: 'forbidden' },
    'save',
    '저장했지만 사용할 수 없습니다: 키에 필요한 권한이 없습니다',
    'error',
  ],
  [
    'rate_limited',
    { vendorLabel: VENDOR, status: 'rate_limited', lastErrorCode: 'rate_limited' },
    'save',
    '저장했지만 사용할 수 없습니다: 벤더 사용 한도를 초과했습니다',
    'error',
  ],
  [
    'unavailable',
    { vendorLabel: VENDOR, status: 'unverified', lastErrorCode: 'unavailable' },
    'save',
    '저장했지만 벤더 응답이 없어 확인하지 못했습니다 — 잠시 후 [검증]을 다시 누르세요',
    'error',
  ],
  [
    'unreadable',
    { vendorLabel: VENDOR, status: 'unreadable', lastErrorCode: null },
    'verify',
    '키를 읽을 수 없습니다 — 다시 등록하세요',
    'error',
  ],
];

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});

describe('AC-367 ① 챗봇 안내 문구 = PRAMI-002 §4.9 표', () => {
  it.each(Object.entries(CHAT_TABLE))('%s', (status, text) => {
    expect(setupFor(status as SetupStatus, { vendor: VENDOR, model: MODEL }).message).toBe(text);
  });

  it('missing 은 MISSING_MESSAGE 상수(§4.8.2 ③) — /api/chat/status 와 첫 응답 setup.message 가 같은 문구', async () => {
    const env = {
      CHAT_LLM_ENABLED: true,
      LLM_VENDOR_MODE: 'fake',
      LLM_OAUTH_OPENROUTER: false,
    } as unknown as Parameters<typeof chatStatus>[0]['env'];
    const status = await chatStatus({ db: ctx.handle.db, userId: ctx.userId, env });
    expect('setup' in status ? status.setup?.message : undefined).toBe(MISSING_MESSAGE);
    const reply = await ask(scriptedRuntime(ctx.handle, { status: 'missing' }), 'Wapples-500 가격');
    expect(reply.setup?.message).toBe(MISSING_MESSAGE);
    expect(MISSING_MESSAGE).toBe(CHAT_TABLE.missing);
  });

  it.each(['invalid', 'forbidden', 'unreadable'] as const)(
    '챗봇 응답 setup.message(%s) = setupFor 같은 원천',
    async (status) => {
      const reply = await ask(scriptedRuntime(ctx.handle, { status }), 'Wapples-500 가격');
      expect(reply.setup?.message).toBe(setupFor(status, { vendor: 'Anthropic (Claude)' }).message);
    },
  );
});

describe('AC-367 ① 설정 검증 결과 = PRAMI-002 §4.9.1 표', () => {
  it.each(SETTINGS_TABLE)('%s', (_label, view, kind, text, tone) => {
    const result = verifyResultMessage(view, kind);
    expect(result.tone).toBe(tone);
    // 화면 형식: "<벤더> <표 문구>" · "<벤더> 키를 <표 문구>" · "<벤더>: <표 문구>"
    expect([`${VENDOR} ${text}`, `${VENDOR} 키를 ${text}`, `${VENDOR}: ${text}`]).toContain(
      result.text,
    );
  });
});

describe('AC-367 ② llm_error 는 단일 안내 문구 · 벤더 원문 없음', () => {
  it('미분류 오류·요청 거부 모두 notice = LLM_ERROR_NOTICE', async () => {
    const vendorText = 'VENDOR-RAW-ERROR-TEXT do not show';
    for (const thrown of [{ message: vendorText }, { message: vendorText, status: 400 }]) {
      const model = new ScriptedChatModel([{ throw: thrown }, { throw: thrown }]);
      const reply = await ask(
        scriptedRuntime(ctx.handle, { status: 'ready', model }),
        'Wapples-500 가격',
      );
      expect(reply.mode).toBe('rule');
      expect(reply.notice).toContain(LLM_ERROR_NOTICE);
      expect(JSON.stringify(reply)).not.toContain(vendorText);
    }
  });

  it('truncated_output notice 는 §4.5.5 L-1 문구', () => {
    expect(TRUNCATED_OUTPUT_NOTICE).toBe('답변이 길어 일부만 표시합니다.');
  });
});
