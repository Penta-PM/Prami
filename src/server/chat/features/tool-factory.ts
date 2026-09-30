import { tool, type StructuredToolInterface } from '@langchain/core/tools';

import type { ChatToolDef } from './types';

/**
 * 레지스트리 도구 → LangChain 도구 (`bindTools` 에 넘길 이름·설명·입력 스키마). 실행은 그래프의 `tools` 노드가
 * 권한 재검사·strict 출력 파싱·금지 키 검사를 거쳐 직접 한다 — 이 함수 본체는 모델이 직접 실행하지 못하게 막아 둔다.
 */
export function toLangChainTool(def: ChatToolDef): StructuredToolInterface {
  return tool(
    async () => {
      throw new Error('챗봇 도구는 그래프 tools 노드에서만 실행한다');
    },
    { name: def.name, description: def.description, schema: def.input as never },
  ) as unknown as StructuredToolInterface;
}
