/**
 * LLM 모델 상수 (PRAMI-002 §4.5.2). 모델 ID 는 이 파일 한 곳에서만 관리한다 — 설정 화면 선택지·기본값이 여기서 온다.
 * 출처·기준일은 스펙 표(2026-09-30). 스펙 r2 에서 표가 보정되면 이 파일만 바꾼다(PR-A 는 선택지 검증에만 사용).
 * 요금은 사용자 벤더 계정에 청구된다 — 금액 대신 상대 등급 라벨만 보인다.
 */
export type ModelTier = 'low' | 'balanced' | 'top';

export type LlmModelOption = { id: string; label: string; tier: ModelTier };

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  low: '저가',
  balanced: '균형',
  top: '최상위',
};

export const LLM_MODELS = {
  anthropic: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'top' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'balanced' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'low' },
  ],
  openai: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'balanced' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'low' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'top' },
  ],
  google: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'balanced' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tier: 'low' },
  ],
} as const satisfies Record<string, readonly LlmModelOption[]>;

export const DEFAULT_MODELS: Record<keyof typeof LLM_MODELS, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-6.1-sol',
  google: 'gemini-3.8-flash',
};

export function modelsFor(vendor: string): readonly LlmModelOption[] {
  return (LLM_MODELS as Record<string, readonly LlmModelOption[]>)[vendor] ?? [];
}

export function isKnownModel(vendor: string, model: string): boolean {
  return modelsFor(vendor).some((option) => option.id === model);
}
