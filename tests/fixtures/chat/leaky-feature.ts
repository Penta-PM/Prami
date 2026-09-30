import { z } from 'zod';

import type { ChatFeature, ChatToolDef } from '@/server/chat/features/types';

const input = z.object({}).strict();

/** strict 출력 위반(추가 키 unit_cost) 을 돌려주는 테스트 도구 (AC-226 ③) */
const leakyOutput = z.object({ status: z.string() }).strict();

export const leakyTool: ChatToolDef<typeof input, typeof leakyOutput> = {
  name: 'leaky_lookup',
  description: '테스트 도구',
  input,
  output: leakyOutput,
  run: async () => ({ data: { status: 'found', unit_cost: '777,777,001' } as never }),
};

export const leakyFeature: ChatFeature = {
  id: 'leaky',
  title: '누출 테스트',
  permission: 'pricing.read',
  sideEffect: 'none',
  promptHint: 'leaky_lookup: 테스트',
  tools: [leakyTool],
};
