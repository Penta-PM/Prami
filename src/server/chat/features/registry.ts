import { hasPermission } from '@/lib/constants/permissions';

import { compareFeature } from './compare';
import { pricingFeature } from './pricing';
import { quoteFeature } from './quote';
import type { ChatFeature, ChatToolDef, ToolActor } from './types';

/**
 * 챗봇 기능 레지스트리 (PRAMI-002 §4.3.4). **여기 한 줄 추가가 "기능 삽입"** — 그래프·노드 코드는 바뀌지 않는다(AC-233).
 * 원가 기능·도구는 존재하지 않는다(I-1·I-2). 순서 = 시스템 프롬프트 기능 목록 순서(고정).
 */
export const CHAT_FEATURES: readonly ChatFeature[] = [pricingFeature, compareFeature, quoteFeature];

function allowed(feature: ChatFeature, actor: Pick<ToolActor, 'role'>): boolean {
  return (feature.enabled?.() ?? true) && hasPermission(actor.role, feature.permission);
}

/** 이 사용자에게 노출할 도구 (bindTools 대상) */
export function toolsFor(
  features: readonly ChatFeature[],
  actor: Pick<ToolActor, 'role'>,
): ChatToolDef[] {
  return features.filter((feature) => allowed(feature, actor)).flatMap((feature) => feature.tools);
}

/** 실행 시 재검사 — 모델이 목록 밖 도구 이름을 만들어 내도 실행되지 않는다(2중 방어) */
export function findAllowedTool(
  features: readonly ChatFeature[],
  actor: Pick<ToolActor, 'role'>,
  name: string,
): ChatToolDef | null {
  return toolsFor(features, actor).find((tool) => tool.name === name) ?? null;
}

export function promptHints(features: readonly ChatFeature[]): string[] {
  return features.map((feature) => feature.promptHint);
}
