import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

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
  | 'refusal';

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

export function createFakeChatModel(secret: string): FakeChatModel {
  return new FakeChatModel(fakeBehaviorFor(secret));
}
