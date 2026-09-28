import type { Db } from '@/db';
import { priceLabel } from '@/lib/pricing/format';

import { classifyIntent, PRODUCT_FAMILIES, type ChatIntent } from './intent';
import {
  countFamilyItems,
  findChatItemsByTerms,
  latestChatPrice,
  previousChatPrice,
  type ChatItemHit,
  type ChatPrice,
} from './queries';

/**
 * 챗봇 응답 (§4.5.9, AC-80~82): 의도별로 sales_prices 를 읽어 템플릿 문장을 만든다. 디자인(chatReply)의 문장 톤을 따르되 값은 DB.
 * - 원가(AC-81): 역할과 무관하게 DB 를 전혀 읽지 않고 거부 문구만 돌려준다 (ADMIN 도 챗봇에서는 원가 미노출 — 챗봇 응답은 원가 키가
 *   없어야 한다는 AC-43 을 단순하게 지키기 위함. 원가는 원가 관리 화면에서).
 * - 대화는 저장하지 않는다.
 */
export type ChatCandidate = ChatItemHit;

export type ChatReply = {
  intent: ChatIntent['kind'];
  reply: string;
  /** 모호할 때 고를 후보 (클릭하면 품번으로 다시 질문) */
  candidates: ChatCandidate[];
  /** 제품군 퀵칩을 보여 줄지 */
  showProductChips: boolean;
  /** 견적 시작 링크 */
  action: { type: 'calculator'; href: string; label: string } | null;
};

export const HELP_REPLY =
  '아직 학습 중인 질문이에요. "Wapples-500 가격", "작년보다 올랐어?", "견적 뽑아줘" 같은 질문을 시도해보세요.';
export const COST_REPLY =
  '원가 정보는 챗봇에서 제공하지 않습니다. 대신 견적 계산기에서 예상 견적 금액을 확인해보세요.';
export const COST_REPLY_USER =
  '원가 정보는 관리자만 조회할 수 있습니다. 대신 견적 계산기에서 예상 견적 금액을 확인해보세요.';
export const PRICE_NEED_MODEL =
  '제품명과 모델명을 함께 말씀해주시면 정확한 가격을 알려드릴게요. 예: "WAPPLES Wapples-500 가격 알려줘"';
export const QUOTE_ASK_PRODUCT = '어떤 제품의 견적을 도와드릴까요?';

const reply = (partial: Partial<ChatReply> & Pick<ChatReply, 'intent' | 'reply'>): ChatReply => ({
  candidates: [],
  showProductChips: false,
  action: null,
  ...partial,
});

const yearOf = (iso: string) => iso.slice(0, 4);

export function calculatorHref(family: string | null, itemCode?: string): string {
  const params = new URLSearchParams();
  if (family) params.set('family', family);
  if (itemCode) params.set('item', itemCode);
  const query = params.toString();
  return query ? `/calculator?${query}` : '/calculator';
}

function priceSentence(price: ChatPrice): string {
  const type = price.priceType && price.priceType !== '정상판매' ? ` (${price.priceType})` : '';
  return `${yearOf(price.effectiveFrom)}년 기준 ${price.productFamily} ${price.itemName.trim()}의 가격은 ${priceLabel(price.unitPrice, price.currency)}입니다${type}.`;
}

function candidatesReply(intent: ChatIntent['kind'], hits: ChatItemHit[]): ChatReply {
  return reply({
    intent,
    reply: '여러 품목이 검색되었습니다. 어떤 모델을 말씀하시나요? 아래에서 골라주세요.',
    candidates: hits,
  });
}

function notFoundReply(intent: ChatIntent['kind'], query: string): ChatReply {
  return reply({
    intent,
    reply: `"${query}" 에 해당하는 품목을 찾지 못했습니다. 품명이나 품번을 다시 확인해주세요. 예: "Wapples-500 가격"`,
    showProductChips: true,
  });
}

/** 검색어 → 단일 품목 확정(정확 일치 1건이면 그것), 여럿이면 후보 목록 */
async function resolveItem(
  db: Db,
  intent: ChatIntent,
): Promise<{ item: ChatItemHit } | { reply: ChatReply }> {
  const query = intent.query!;
  const hits = await findChatItemsByTerms(db, intent.terms, intent.family);
  if (hits.length === 0) return { reply: notFoundReply(intent.kind, query) };
  if (hits.length === 1) return { item: hits[0]! };
  const lower = query.toLowerCase();
  const exact = hits.filter(
    (hit) => hit.itemCode.toLowerCase() === lower || hit.itemName.trim().toLowerCase() === lower,
  );
  if (exact.length === 1) return { item: exact[0]! };
  return { reply: candidatesReply(intent.kind, hits) };
}

async function answerPrice(db: Db, intent: ChatIntent): Promise<ChatReply> {
  if (!intent.query) {
    return reply({ intent: 'price', reply: PRICE_NEED_MODEL, showProductChips: true });
  }
  const resolved = await resolveItem(db, intent);
  if ('reply' in resolved) return resolved.reply;
  const price = await latestChatPrice(db, resolved.item.itemCode);
  if (!price) {
    return reply({
      intent: 'price',
      reply: `${resolved.item.itemName.trim()}(${resolved.item.itemCode})은 현재 운영중인 판매단가가 없습니다.`,
    });
  }
  return reply({
    intent: 'price',
    reply: priceSentence(price),
    action: {
      type: 'calculator',
      href: calculatorHref(price.productFamily, price.itemCode),
      label: '이 품목으로 견적 시작',
    },
  });
}

async function answerCompare(db: Db, intent: ChatIntent): Promise<ChatReply> {
  if (!intent.query) {
    return reply({
      intent: 'compare',
      reply:
        '어떤 제품의 가격 변동이 궁금하신가요? 모델명을 함께 알려주세요. 예: "Wapples-500 작년보다 올랐어?"',
      showProductChips: true,
    });
  }
  const resolved = await resolveItem(db, intent);
  if ('reply' in resolved) return resolved.reply;
  const current = await latestChatPrice(db, resolved.item.itemCode);
  if (!current) {
    return reply({
      intent: 'compare',
      reply: `${resolved.item.itemName.trim()}(${resolved.item.itemCode})은 현재 운영중인 판매단가가 없어 비교할 수 없습니다.`,
    });
  }
  const previous = await previousChatPrice(db, current);
  if (!previous) {
    return reply({
      intent: 'compare',
      reply: `${current.itemName.trim()}의 이전 적용 가격 데이터가 없어 전년과 비교할 수 없습니다.\n현재(${yearOf(current.effectiveFrom)}년 적용) 가격은 ${priceLabel(current.unitPrice, current.currency)}입니다.`,
    });
  }
  return reply({ intent: 'compare', reply: compareSentence(current, previous) });
}

export function compareSentence(current: ChatPrice, previous: ChatPrice): string {
  const before = Number(previous.unitPrice);
  const after = Number(current.unitPrice);
  const head = `${yearOf(previous.effectiveFrom)}년 ${current.productFamily} ${current.itemName.trim()} 가격은 ${priceLabel(previous.unitPrice, previous.currency)}이며, ${yearOf(current.effectiveFrom)}년에는 ${priceLabel(current.unitPrice, current.currency)}으로 변경되었습니다.`;
  if (before <= 0 || previous.currency !== current.currency) {
    return `${head}\n이전 가격 기준이 달라 변동률은 계산하지 않았습니다.`;
  }
  const pct = ((after - before) / before) * 100;
  if (Math.abs(pct) < 0.05) return `${head}\n이전 적용가와 같은 금액입니다.`;
  const direction = pct > 0 ? '상승' : '하락';
  return `${head}\n전년 대비 약 ${Math.abs(pct).toFixed(1)}% ${direction}했습니다.`;
}

async function answerQuote(db: Db, intent: ChatIntent): Promise<ChatReply> {
  if (!intent.query) {
    if (intent.family) {
      const count = await countFamilyItems(db, intent.family);
      return reply({
        intent: 'quote',
        reply: `${intent.family} 견적을 시작합니다. 모델과 옵션은 견적 계산기 화면에서 이어서 선택해주세요. (운영중 품목 ${count}개)`,
        action: {
          type: 'calculator',
          href: calculatorHref(intent.family),
          label: `${intent.family} 견적 계산기 열기`,
        },
      });
    }
    return reply({ intent: 'quote', reply: QUOTE_ASK_PRODUCT, showProductChips: true });
  }
  const resolved = await resolveItem(db, intent);
  if ('reply' in resolved) return resolved.reply;
  const item = resolved.item;
  return reply({
    intent: 'quote',
    reply: `${item.itemName.trim()}(${item.itemCode}) 견적을 시작합니다. 수량·파츠·할인율은 견적 계산기 화면에서 이어서 선택해주세요.`,
    action: {
      type: 'calculator',
      href: calculatorHref(item.productFamily, item.itemCode),
      label: '견적 계산기에서 이어서 선택',
    },
  });
}

export type ChatActor = { role: 'USER' | 'ADMIN' };

/** 메시지 → 응답. 원가 의도는 DB 를 건드리지 않는다 (db 접근 자체가 없음) */
export async function respondToChat(db: Db, actor: ChatActor, message: string): Promise<ChatReply> {
  const intent = classifyIntent(message);
  switch (intent.kind) {
    case 'cost':
      return reply({
        intent: 'cost',
        reply: actor.role === 'ADMIN' ? COST_REPLY : COST_REPLY_USER,
      });
    case 'compare':
      return answerCompare(db, intent);
    case 'quote':
      return answerQuote(db, intent);
    case 'price':
      return answerPrice(db, intent);
    default:
      return reply({ intent: 'help', reply: HELP_REPLY, showProductChips: false });
  }
}

export const PRODUCT_CHIPS = [...PRODUCT_FAMILIES];
