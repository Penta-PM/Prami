# 챗봇 기능 확장 가이드

PRAMI-002 §4.3.4·§4.3.6 (PR-C, AC-245). 챗봇은 LangGraph 그래프(`src/server/chat/graph/*`)와 **기능(도구) 레지스트리**
(`src/server/chat/features/registry.ts`)로 이뤄진다. 새 기능은 `ChatFeature` 하나를 만들어 레지스트리 배열에 한 줄 추가하면
그래프·노드 코드를 고치지 않고 LLM 이 호출할 수 있게 된다(AC-233). 벤더 추가는 아래 "벤더 추가" 절(AC-242).

## 절차 (7단계)

1. **범위 확인** — 새 기능이 읽는 데이터가 요청자 권한(I-1) 안인지 확인한다. 원가·타인 데이터·자격 증명은 대상이 될 수 없다.
   쓰기 기능이면 이 절차가 아니라 별도 스펙(확인 단계 interrupt + 체크포인터 도입)으로 간다 — 레지스트리는 `sideEffect: 'none'` 만 받는다(I-7).
2. **기능 파일** — `src/server/chat/features/<id>.ts` 에 `ChatFeature` 를 만든다. `permission`, `promptHint`(한 줄·고정 문자열),
   도구의 `input`(strict zod — 선택 인자는 `nullable`)·`output`(strict zod)·`run`, 선택 `statusLabel`(스트리밍 진행 표시)을 쓴다.
   데이터 접근은 기존 `server/<도메인>/queries.ts` 를 재사용한다. `server/cost`·`materialCosts`·`userLlmCredentials` 는 ESLint 가 막는다.
   도구 이름·설명·promptHint 에 원가 계열 단어(원가·매입·구매단가·마진·cost·margin)를 쓰지 않는다(레지스트리 공통 테스트가 검사).
3. **등록** — `registry.ts` 의 `CHAT_FEATURES` 배열에 추가한다. 플래그가 필요하면 `enabled: () => env.CHAT_FEATURE_<ID>`(`env` 는 `@/env` 모듈 — r4 시그니처 `enabled?: () => boolean`) 를 걸고
   env 는 `src/env.ts` 에 추가한다.
4. **테스트** — ① 도구 단위(입력 경계·출력 strict·금지 키) ② 스크립트 모델이 새 도구를 호출하는 그래프 통합 1건
   ③ 권한 없는 역할에서 `toolsFor` 에 없고 강제 호출 시 거부. 레지스트리 공통 테스트(`tests/unit/chat/graph-units.test.ts`, AC-233)는
   `CHAT_FEATURES` 에 들어온 새 기능을 자동으로 검사한다(이름 유일·snake_case·sideEffect·strict·금지어).
5. **규칙 폴백(선택)** — LLM 없이도 지원하려면 `src/server/chat/intent.ts` 에 의도를 추가하고 `ruleIntent` 를 표기한다.
   폴백 미지원 기능은 키 미등록 사용자에게 기존 규칙 답 + "LLM 연결 후 사용 가능" 안내가 나간다.
6. **스트리밍 진행 표시(선택)** — 도구에 `statusLabel` 을 주면 tools 노드가 `config.writer({ type: 'tool_status', label })` 로
   SSE `event: status` 를 보낸다(패널이 "…중" 으로 표시).
7. **PR 본문** — 새 도구의 입력·출력 스키마와 원가 불변식 테스트(AC-225 쿼리 로거·AC-226 발신 페이로드) 재실행 결과를 첨부한다.

## 예제 기능 — `notice_count`

아래 코드는 `tests/fixtures/chat/sample-feature.ts` 와 **같은 내용**이다(문서-코드 일치 테스트 `tests/unit/chat/extending-doc.test.ts`).
실제 기능은 `src/server/chat/features/` 에 두고 `CHAT_FEATURES` 에 추가한다 — 예제는 테스트가 레지스트리 인자로만 넣는다.

<!-- include: tests/fixtures/chat/sample-feature.ts -->
```ts
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { PermissionKey } from '@/lib/constants/permissions';
import type { ChatFeature, ChatToolDef } from '@/server/chat/features/types';
import { queryRows } from '@/server/imports/sql-rows';

/**
 * AC-233 테스트 전용 기능: `notice_count`(권한 notice.read). 레지스트리 인자로만 넣어 **그래프·노드 코드 수정 없이** 라우팅되는지 본다.
 * 권한을 바꾼 변형(users.manage)은 USER 에게 노출·실행되지 않아야 한다.
 */
const input = z.object({}).strict();
const output = z.object({ count: z.number().int() }).strict();

export const noticeCountTool: ChatToolDef<typeof input, typeof output> = {
  name: 'notice_count',
  description: '게시된 공지사항 개수를 센다.',
  input,
  output,
  run: async (_args, { db }) => {
    const [row] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from notices`);
    return { data: { count: row?.n ?? 0 } };
  },
};

export function sampleFeature(permission: PermissionKey = 'notice.read'): ChatFeature {
  return {
    id: 'sample',
    title: '공지 개수 (테스트)',
    permission,
    sideEffect: 'none',
    promptHint: 'notice_count: 공지사항 개수',
    tools: [noticeCountTool],
  };
}
```

## 테스트 예제

`tests/unit/chat/sample-feature.example.test.ts` 와 같은 내용이다(4단계의 ①②③).

<!-- include: tests/unit/chat/sample-feature.example.test.ts -->
```ts
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
```

## 벤더 추가 (AC-242)

벤더 = 어댑터 파일 1개 + `src/server/llm/vendors/registry.ts` 의 `LLM_VENDORS` 1줄 + `src/server/llm/models.ts` 모델 상수.
어댑터(`LlmVendor`)는 `host`(검증·채팅 호출 호스트 — 코드 상수, SSRF 방지), `keyFormat`, `verifyRequest`(토큰 소비 없는 목록/키 조회 호출),
`parseModelList`, `createChatModel`(요청마다 새 인스턴스, `maxRetries: 1`·타임아웃, 강제 도구 선택 없음)을 채운다.
설정 카드·등록·검증·챗봇 경로는 레지스트리에서 파생하므로 추가 코드가 없다(`tests/unit/settings/vendor-extension*.test.ts`).
OAuth 전용 벤더는 `authTypes: ['oauth_pkce']` + `enabled: (flags) => …`(env 플래그) — 카드에 연결 버튼이 뜨고 키 직접 저장은 거부된다.
