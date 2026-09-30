/**
 * LLM 모델 상수 (PRAMI-002 §4.5.2, r2). 모델 ID 는 이 파일 한 곳에서만 관리한다 — 설정 화면 선택지·기본값·검증이 여기서 온다.
 * 요금은 사용자 벤더 계정에 청구된다 — 금액 대신 상대 등급 라벨만 보인다. 상수 갱신은 코드 PR 로만, 출처를 다시 확인하고 확인일을 고친다.
 *
 * 출처·확인일 (2026-09-30 확인):
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview — "start with Claude Opus 5.5 for most workloads".
 *   현행 Opus 5.5 / Sonnet 5.5 / Haiku 4.5(Claude API alias `claude-haiku-4-5`, ID 는 날짜 스냅샷 — 상수에는 별칭만, 날짜 접미사 금지).
 *   레거시 Opus 5(`claude-opus-5`, https://platform.claude.com/docs/en/models/opus-5/overview)·
 *   Sonnet 5(`claude-sonnet-5`, https://platform.claude.com/docs/en/models/sonnet-5/overview) — "Legacy models (still available)".
 *   Fable 5.1 은 요금이 커서 챗봇 조회 용도 선택지에서 제외(스펙 표).
 * - OpenAI: https://developers.openai.com/api/docs/models — gpt-6-astra · gpt-6.1-sol · gpt-6-luna.
 * - Google: https://ai.google.dev/gemini-api/docs/models — gemini-3.8-flash · gemini-3.5-flash-lite (stable). Pro 는 preview 뿐이라 제외.
 * - OpenRouter(PR-C, OAuth 전용·플래그): 모델 페이지(2026-09-30) https://openrouter.ai/anthropic/claude-sonnet-5.5 ·
 *   https://openrouter.ai/openai/gpt-6.1-sol · https://openrouter.ai/google/gemini-3.8-flash 의 모델 ID.
 */
export type ModelTier = 'low' | 'balanced' | 'top';
export type ModelLifecycle = 'current' | 'legacy';

export type LlmModelOption = {
  /** 벤더 API ID 그대로 (Anthropic 은 날짜 접미사 없는 ID) */
  id: string;
  label: string;
  tier: ModelTier;
  /** legacy 는 선택 가능하지만 '레거시' 표시, 현행 뒤에 정렬 */
  lifecycle: ModelLifecycle;
  /** 벤더당 정확히 1개 (current 중에서) */
  isDefault?: true;
  /** Anthropic 모델별 요청 제약 (§4.5.3) — 어댑터가 이 플래그만 보고 요청을 만든다 */
  anthropic?: AnthropicModelTraits;
};

/**
 * Anthropic 요청 제약 (스펙 r2 §4.5.3, 2026-09-30 공식 문서 기준). `thinking` 파라미터는 어떤 모델에도 보내지 않는다
 * (Opus 5.5 는 항상 adaptive — `{type:'disabled'}`·`budget_tokens` 400, Haiku 4.5 는 챗봇에서 사고 없이 호출).
 * - effort: `output_config.effort` 값. null 이면 보내지 않는다(Haiku 4.5 는 effort 미지원)
 * - serverFallback: `fallbacks: "default"` + 베타 헤더 `server-side-fallback-2026-07-01` (Claude API 직접 호출 전용)
 */
export type AnthropicModelTraits = { effort: 'low' | null; serverFallback: boolean };

const ADAPTIVE_LOW_WITH_FALLBACK: AnthropicModelTraits = { effort: 'low', serverFallback: true };
/**
 * 서버측 폴백 미지원 레거시 (PR-B QA M-1): 공식 문서 https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
 * (2026-09-30 확인)는 안전 분류기·서버측 폴백 대상을 Fable 5.1·Fable 5·Opus 5.5·Opus 5·Sonnet 5.5 로만 명시한다.
 * Sonnet 5 는 목록에 없고 Sonnet 5.5 의 폴백 대상일 뿐이다 → 보내지 않는다(불확실하면 보내지 않는 쪽이 기본).
 */
const ADAPTIVE_LOW_NO_FALLBACK: AnthropicModelTraits = { effort: 'low', serverFallback: false };
const HAIKU_TRAITS: AnthropicModelTraits = { effort: null, serverFallback: false };

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  low: '저가',
  balanced: '균형',
  top: '최상위',
};

export const LEGACY_LABEL = '레거시';

export const LLM_MODELS = {
  anthropic: [
    {
      id: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      tier: 'top',
      lifecycle: 'current',
      isDefault: true,
      anthropic: ADAPTIVE_LOW_WITH_FALLBACK,
    },
    {
      id: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      tier: 'balanced',
      lifecycle: 'current',
      anthropic: ADAPTIVE_LOW_WITH_FALLBACK,
    },
    {
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      tier: 'low',
      lifecycle: 'current',
      anthropic: HAIKU_TRAITS,
    },
    {
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      tier: 'top',
      lifecycle: 'legacy',
      anthropic: ADAPTIVE_LOW_WITH_FALLBACK,
    },
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      tier: 'balanced',
      lifecycle: 'legacy',
      anthropic: ADAPTIVE_LOW_NO_FALLBACK,
    },
  ],
  openai: [
    {
      id: 'gpt-6.1-sol',
      label: 'GPT-6.1 Sol',
      tier: 'balanced',
      lifecycle: 'current',
      isDefault: true,
    },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'low', lifecycle: 'current' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'top', lifecycle: 'current' },
  ],
  google: [
    {
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      tier: 'balanced',
      lifecycle: 'current',
      isDefault: true,
    },
    {
      id: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash-Lite',
      tier: 'low',
      lifecycle: 'current',
    },
  ],
  openrouter: [
    {
      id: 'anthropic/claude-sonnet-5.5',
      label: 'Claude Sonnet 5.5 (OpenRouter)',
      tier: 'balanced',
      lifecycle: 'current',
      isDefault: true,
    },
    {
      id: 'openai/gpt-6.1-sol',
      label: 'GPT-6.1 Sol (OpenRouter)',
      tier: 'balanced',
      lifecycle: 'current',
    },
    {
      id: 'google/gemini-3.8-flash',
      label: 'Gemini 3.8 Flash (OpenRouter)',
      tier: 'balanced',
      lifecycle: 'current',
    },
  ],
} as const satisfies Record<string, readonly LlmModelOption[]>;

export function modelsFor(vendor: string): readonly LlmModelOption[] {
  return (LLM_MODELS as Record<string, readonly LlmModelOption[]>)[vendor] ?? [];
}

/** 모델 표시 라벨 (§4.9 {모델} 치환 — 사용자 입력이 아니라 상수 라벨) */
export function modelLabel(vendor: string, model: string): string {
  return modelsFor(vendor).find((option) => option.id === model)?.label ?? model;
}

export function findModel(vendor: string, model: string): LlmModelOption | undefined {
  return modelsFor(vendor).find((option) => option.id === model);
}

export function isKnownModel(vendor: string, model: string): boolean {
  return modelsFor(vendor).some((option) => option.id === model);
}

/** 벤더 기본 모델 (isDefault). 레지스트리에 없는 벤더는 null */
export function defaultModelFor(vendor: string): string | null {
  return modelsFor(vendor).find((option) => option.isDefault)?.id ?? null;
}

/** 목록 API 의 ID 를 상수 ID 형태로: Gemini `models/` 접두 제거, Anthropic 날짜 스냅샷 `-YYYYMMDD` 접미 제거 */
function normalizeListedId(id: string): string {
  return id.replace(/^models\//, '').replace(/-\d{8}$/, '');
}

/**
 * 사용 가능 모델 = 벤더 목록 API 응답 ∩ 상수 (§4.5.2·§4.6.3, AC-207 ⑦). 상수 순서를 따른다.
 * 목록에 없는 상수 모델은 "이 키로 사용 불가", 상수에 없는 목록 모델은 무시한다.
 */
export function intersectAvailableModels(vendor: string, listedIds: readonly string[]): string[] {
  const listed = new Set(listedIds.map(normalizeListedId));
  return modelsFor(vendor)
    .map((option) => option.id)
    .filter((id) => listed.has(id));
}
