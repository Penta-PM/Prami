import { logger } from '@/server/log';

import { COST_REPLY, COST_REPLY_USER } from '../respond';

/**
 * 원가 차단·출력 가드 (PRAMI-002 §4.4.2·§4.4.3).
 * - assertNoCostKeys: 도구 결과·최종 응답에 원가 계열 키 이름이 있으면 예외 (PRAMI-001 AC-43 키의 상위 집합)
 * - guardReplyText: 최종 텍스트에 원가 단어 + 금액 패턴이 같은 문장에 있으면 역할별 거부 문구로 교체, 길이·제어 문자 정리
 */
const FORBIDDEN_KEYS = new Set([
  'unit_cost',
  'unitCost',
  'material_code',
  'materialCode',
  'cost',
  'costs',
  'margin',
  'purchase_price',
]);

export class CostKeyError extends Error {
  constructor(readonly path: string) {
    super(`원가 계열 키가 들어 있습니다: ${path}`);
    this.name = 'CostKeyError';
  }
}

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key) || /cost/i.test(key);
}

export function assertNoCostKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCostKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenKey(key)) throw new CostKeyError(`${path}.${key}`);
    assertNoCostKeys(entry, `${path}.${key}`);
  }
}

/**
 * 원가 계열 단어 — 스펙 §4.4.3 목록(원가·매입가·구매단가·매입 단가)에 시스템 프롬프트·precheck(COST_RE)와 같은 어휘
 * (마진·이익률·이익금·순이익, 영문 cost·margin)를 더한 상위 집합 (PR-B 자체 보안 리뷰 반영)
 */
const COST_WORD =
  /원가|매입가|구매\s?단가|매입\s?단가|마진|이익률|이익금|순이익|\bcosts?\b|\bmargins?\b/i;
const AMOUNT = /\d[\d,]*\s*(원|KRW|USD|JPY|\$|엔)|\$\s*\d/;
export const REPLY_MAX_LENGTH = 1500;
export const REPLY_TRUNCATED_SUFFIX = '… (답변이 길어 일부만 표시합니다)';

type GuardInput = {
  text: string;
  role: 'USER' | 'ADMIN';
  vendor: string | null;
  model: string | null;
};

/** 문장 단위로 원가 단어와 금액이 함께 있는지 */
function mentionsCostAmount(text: string): boolean {
  return text
    .split(/(?<=[.!?。\n])/)
    .some((sentence) => COST_WORD.test(sentence) && AMOUNT.test(sentence));
}

export function guardReplyText({ text, role, vendor, model }: GuardInput): string {
  if (mentionsCostAmount(text)) {
    // 내용은 남기지 않는다 — 벤더·모델만
    logger.warn('chat.guard.cost_text', { vendor, model });
    return role === 'ADMIN' ? COST_REPLY : COST_REPLY_USER;
  }
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return clean.length > REPLY_MAX_LENGTH
    ? `${clean.slice(0, REPLY_MAX_LENGTH)}${REPLY_TRUNCATED_SUFFIX}`
    : clean;
}
