import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';

/**
 * 가짜 채팅 모델 (PRAMI-002 §9.1, `LLM_VENDOR_MODE=fake` — production·VERCEL_ENV 거부). 실벤더 없이 E2E·QA 가 LLM 경로를 재현한다.
 * 키 문자열은 **보관하지 않는다** — 생성 시 접두로 동작(behavior)만 정하고 버린다(키 격리 AC-228).
 *
 * | 접두 | 동작 |
 * | `fake-valid-` 등 정상 키 | Human 다음 → `price_lookup({query: 질문})` 도구 호출, 도구 결과 다음 → 결과 요약 문장 |
 * | `fake-401-` / `fake-gemini400-` | 401 / Gemini 식 400 API_KEY_INVALID |
 * | `fake-403-` `fake-404-` `fake-429-` `fake-500-` | 해당 HTTP 상태 오류 |
 * | `fake-timeout-` | 호출 신호가 끊길 때까지 응답하지 않음(타임아웃 경로) |
 * | `fake-refusal-` | stop_reason=refusal (content 는 응답에 쓰면 안 되는 표식 문구) |
 * | `fake-mirror-` | 도구 없이 마지막 Human 메시지에서 `§` 를 지운 텍스트를 3자 청크로 스트리밍 (출력 가드 E2E, 가드 2차 스펙 §2 PR-1) |
 * 오류 메시지에는 표식 `FAKE-VENDOR-MESSAGE` 를 넣는다 — 응답·로그에 벤더 원문이 없음을 테스트가 확인한다(AC-223).
 */
export type FakeChatBehavior =
  | 'answer'
  | 'status401'
  | 'gemini400'
  | 'status403'
  | 'status404'
  | 'status429'
  | 'status500'
  | 'timeout'
  | 'refusal'
  | 'mirror';

export const FAKE_VENDOR_MARKER = 'FAKE-VENDOR-MESSAGE';
export const FAKE_REFUSAL_CONTENT = 'FAKE-REFUSAL-CONTENT 거부 사유 원문';

const PREFIXES: [string, FakeChatBehavior][] = [
  ['fake-401-', 'status401'],
  ['fake-invalid-', 'status401'],
  ['fake-gemini400-', 'gemini400'],
  ['fake-403-', 'status403'],
  ['fake-404-', 'status404'],
  ['fake-429-', 'status429'],
  ['fake-500-', 'status500'],
  ['fake-timeout-', 'timeout'],
  ['fake-refusal-', 'refusal'],
  ['fake-mirror-', 'mirror'],
];

export function fakeBehaviorFor(secret: string): FakeChatBehavior {
  return PREFIXES.find(([prefix]) => secret.startsWith(prefix))?.[1] ?? 'answer';
}

function vendorError(status: number, body: unknown): Error {
  return Object.assign(new Error(`${status} ${FAKE_VENDOR_MARKER}`), { status, error: body });
}

const ERRORS: Partial<Record<FakeChatBehavior, () => Error>> = {
  status401: () => vendorError(401, { error: { type: 'authentication_error' } }),
  gemini400: () =>
    vendorError(400, {
      error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
    }),
  status403: () => vendorError(403, { error: { type: 'permission_error' } }),
  status404: () => vendorError(404, { error: { type: 'not_found_error' } }),
  status429: () => vendorError(429, { error: { type: 'rate_limit_error' } }),
  status500: () => vendorError(500, { error: { type: 'api_error' } }),
};

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () =>
      reject(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      );
    if (signal?.aborted) return fail();
    signal?.addEventListener('abort', fail, { once: true });
  });
}

/** 도구 결과(JSON) → 한 줄 요약 — 품명·가격만 인용한다 */
function summarize(message: ToolMessage): string {
  try {
    const data = JSON.parse(String(message.content)) as {
      items?: { itemName: string; price?: { unitPrice: string; currency: string } | null }[];
    };
    const parts = (data.items ?? []).map((item) =>
      item.price
        ? `${item.itemName} ${item.price.unitPrice} ${item.price.currency}`
        : item.itemName,
    );
    return parts.length > 0
      ? `[fake LLM] 조회 결과: ${parts.join(', ')}`
      : '[fake LLM] 조회 결과가 없습니다.';
  } catch {
    return '[fake LLM] 도구 결과를 읽지 못했습니다.';
  }
}

export class FakeChatModel extends BaseChatModel {
  private readonly behavior: FakeChatBehavior;
  private readonly toolNames: readonly string[];

  constructor(behavior: FakeChatBehavior, toolNames: readonly string[] = []) {
    super({});
    this.behavior = behavior;
    this.toolNames = toolNames;
  }

  _llmType(): string {
    return 'prami-fake';
  }

  override bindTools(tools: { name: string }[]): FakeChatModel {
    return new FakeChatModel(
      this.behavior,
      tools.map((tool) => tool.name),
    );
  }

  private answer(messages: BaseMessage[]): AIMessage {
    const last = messages.at(-1);
    if (last instanceof ToolMessage) return new AIMessage(summarize(last));
    if (this.toolNames.includes('price_lookup')) {
      const query = String(last?.content ?? '').slice(0, 100);
      return new AIMessage({
        content: '',
        tool_calls: [
          {
            id: `fake-call-${messages.length}`,
            name: 'price_lookup',
            args: { query, family: null },
          },
        ],
      });
    }
    return new AIMessage('[fake LLM] 질문을 받았습니다.');
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    const error = ERRORS[this.behavior];
    if (error) throw error();
    if (this.behavior === 'timeout') await waitForAbort(options.signal);
    const message =
      this.behavior === 'refusal'
        ? new AIMessage({
            content: FAKE_REFUSAL_CONTENT,
            response_metadata: { stop_reason: 'refusal' },
          })
        : this.answer(messages);
    return { generations: [{ text: String(message.content), message }] };
  }
}

/** 미러 표식 (U+00A7) — precheck(COST_RE)를 우회해 출력 가드까지 도달시키려고 입력에 끼운다. 응답에서는 모두 지운다 */
export const MIRROR_MARKER = '\u00a7';
/** 미러 스트리밍 청크 크기 (코드 포인트 기준) — 금액이 청크 경계에 걸쳐 SSE 토큰 가드를 실제로 거치게 한다 */
export const MIRROR_CHUNK_SIZE = 3;

/**
 * 다층 방어 (가드 2차 스펙 §2 PR-1 ②): env.ts 의 fake 모드 기동 거부·registry 의 live 모드 `fake-` 키 거부에 더해,
 * 미러 모델은 배포 환경(production·VERCEL_ENV)이면 생성 자체를 거부한다.
 */
function assertMirrorAllowed(): void {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV) {
    throw new Error('fake mirror model is not allowed in production·VERCEL_ENV');
  }
}

function mirrorTextOf(messages: BaseMessage[]): string {
  const human = messages.findLast((message) => message instanceof HumanMessage);
  const content = human?.content;
  const text =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .map((block) => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
          .join('');
  return text.split(MIRROR_MARKER).join('');
}

/** 코드 포인트 기준 고정 크기 청크 (서로게이트 쌍을 가르지 않는다) */
export function mirrorChunks(text: string, size = MIRROR_CHUNK_SIZE): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += size) {
    chunks.push(chars.slice(start, start + size).join(''));
  }
  return chunks;
}

/**
 * 미러 모델 (`fake-mirror-`): 도구를 부르지 않고 마지막 Human 메시지에서 `§` 를 지운 텍스트를 그대로 돌려준다.
 * `_streamResponseChunks` 를 구현해 스트리밍 경로(SSE messages 모드)에서는 3자 청크로 나눠 토큰 가드를 거친다.
 * 다른 fake 동작의 비스트리밍 경로를 바꾸지 않도록 별도 클래스로 둔다.
 */
export class FakeMirrorChatModel extends BaseChatModel {
  constructor() {
    assertMirrorAllowed();
    super({});
  }

  _llmType(): string {
    return 'prami-fake-mirror';
  }

  override bindTools(): FakeMirrorChatModel {
    return new FakeMirrorChatModel();
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const text = mirrorTextOf(messages);
    return { generations: [{ text, message: new AIMessage(text) }] };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    for (const text of mirrorChunks(mirrorTextOf(messages))) {
      if (options.signal?.aborted) break;
      const chunk = new ChatGenerationChunk({
        message: new AIMessageChunk({ content: text }),
        text,
      });
      yield chunk;
      await runManager?.handleLLMNewToken(text, undefined, undefined, undefined, undefined, {
        chunk,
      });
    }
  }
}

export function createFakeChatModel(secret: string): FakeChatModel | FakeMirrorChatModel {
  const behavior = fakeBehaviorFor(secret);
  return behavior === 'mirror' ? new FakeMirrorChatModel() : new FakeChatModel(behavior);
}
