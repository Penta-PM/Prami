import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

/**
 * 결정적 LLM 대역 (PRAMI-002 §9.1). 생성자에 받은 단계를 순서대로 돌려주고, 호출마다 받은 messages 를 calls 에 기록한다
 * (발신 페이로드 검사용). 오류 주입 `{ throw }`, 지연 `{ delayMs }`(호출 신호가 끊기면 TimeoutError).
 */
export type ScriptStep =
  | { text: string }
  | { toolCalls: { name: string; args: Record<string, unknown> }[] }
  | { refusal: string }
  | { throw: Record<string, unknown> & { message?: string } }
  | { delayMs: number };

export type RecordedCall = { messages: BaseMessage[]; tools: string[] };

export class ScriptedChatModel extends BaseChatModel {
  readonly calls: RecordedCall[];
  /** 지연 단계에서 호출 신호가 끊긴 적이 있는지 (SSE 중단 관찰, AC-243) */
  readonly observed: { aborted: boolean };
  private readonly steps: ScriptStep[];
  private readonly toolNames: string[];
  private readonly cursor: { index: number };

  constructor(
    steps: ScriptStep[],
    shared?: {
      calls: RecordedCall[];
      cursor: { index: number };
      observed?: { aborted: boolean };
    },
    toolNames: string[] = [],
  ) {
    super({});
    this.steps = steps;
    this.calls = shared?.calls ?? [];
    this.cursor = shared?.cursor ?? { index: 0 };
    this.observed = shared?.observed ?? { aborted: false };
    this.toolNames = toolNames;
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(tools: { name: string }[]): ScriptedChatModel {
    return new ScriptedChatModel(
      this.steps,
      { calls: this.calls, cursor: this.cursor, observed: this.observed },
      tools.map((tool) => tool.name),
    );
  }

  /** 마지막으로 바인딩된 도구 이름 (권한 필터 검사) */
  get boundTools(): string[] {
    return this.calls.at(-1)?.tools ?? this.toolNames;
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    this.calls.push({ messages: [...messages], tools: [...this.toolNames] });
    const step = this.steps[this.cursor.index] ?? { text: '(스크립트 끝)' };
    this.cursor.index += 1;
    const message = await this.render(step, options.signal);
    return { generations: [{ text: String(message.content), message }] };
  }

  private async render(step: ScriptStep, signal: AbortSignal | undefined): Promise<AIMessage> {
    if ('throw' in step)
      throw Object.assign(new Error(step.throw.message ?? 'scripted error'), step.throw);
    if ('delayMs' in step) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, step.delayMs);
        signal?.addEventListener('abort', () => {
          this.observed.aborted = true;
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });
      return new AIMessage('(지연 후 응답)');
    }
    if ('refusal' in step) {
      return new AIMessage({
        content: step.refusal,
        response_metadata: { stop_reason: 'refusal' },
      });
    }
    if ('toolCalls' in step) {
      return new AIMessage({
        content: '',
        tool_calls: step.toolCalls.map((call, index) => ({
          id: `call-${this.cursor.index}-${index}`,
          name: call.name,
          args: call.args,
        })),
      });
    }
    return new AIMessage(step.text);
  }
}

/** 호출된 모든 메시지를 직렬화 (발신 페이로드 검사) */
export function serializeCalls(calls: RecordedCall[]): string {
  return JSON.stringify(
    calls.map((call) =>
      call.messages.map((message) => ({
        type: message.getType(),
        content: message.content,
        tool_calls: (message as AIMessage).tool_calls,
      })),
    ),
  );
}
