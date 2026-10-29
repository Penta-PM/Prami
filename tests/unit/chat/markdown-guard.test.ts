import { describe, expect, it } from 'vitest';

import { COST_REPLY, COST_REPLY_USER } from '@/server/chat/respond';
import {
  createTokenGuard,
  guardReplyText,
  mentionsCostAmount,
  REPLY_MAX_LENGTH,
  stripMarkdown,
} from '@/server/chat/graph/guard';
import { clipText } from '@/server/procurement/chat/tools';

/**
 * 챗봇 마크다운 렌더 §2.3 (docs/specs/chat-markdown.md): 판정용 사본에서 마크다운 기호를 지우고, 표는 머리행 + 각 행을 한 문장으로 본다.
 * 최종 가드(guardReplyText)·토큰 가드(createTokenGuard) 각각. 모든 문구는 합성.
 */
const guard = (text: string, terms: readonly string[] = []) =>
  guardReplyText({ text, terms, role: 'ADMIN', vendor: 'fake', model: 'fake' });

/** 토큰 가드에 3자 청크로 흘려 보내고 (내보낸 글, 차단 여부) */
function stream(text: string, terms: readonly string[] = []) {
  const tokens = createTokenGuard();
  tokens.addTerms(terms);
  let out = '';
  for (let i = 0; i < text.length; i += 3) out += tokens.push(text.slice(i, i + 3));
  out += tokens.flush();
  return { out, blocked: tokens.blocked };
}

const COST_TABLE = '| 품목 | 원가 |\n|---|---|\n| A | 1,000원 |';

describe('표 블록 — 머리행 + 데이터 행을 한 문장으로', () => {
  it.each([
    ['앞뒤 파이프', COST_TABLE],
    ['파이프 생략', '품목 | 원가\n--|--\nA | 1,000원'],
    ['정렬 표시', '| 품목 | 매입가 |\n|:---|---:|\n| A | 1,000원 |'],
    ['둘째 행', '| 품목 | 마진 |\n|---|---|\n| A | 판매 |\n| B | 35% |'],
  ])('%s: 원가 단어는 머리행, 금액·비율은 데이터 행 → 차단', (_label, table) => {
    expect(mentionsCostAmount(table)).toBe(true);
    expect(guard(table)).toBe(COST_REPLY);
    expect(guardReplyText({ text: table, role: 'USER', vendor: null, model: null })).toBe(
      COST_REPLY_USER,
    );
  });

  it('토큰 가드: 머리행은 나가도 원가 금액 행은 나가지 않고 이후 차단', () => {
    const { out, blocked } = stream(`${COST_TABLE}\n| B | 2,000원 |\n`);
    expect(blocked).toBe(true);
    expect(out).not.toContain('1,000');
    expect(out).not.toContain('2,000');
  });

  it('판매가 표는 그대로 (오탐 없음)', () => {
    const table = '| 품목 | 판매가 |\n|---|---|\n| Wapples-500 | 12,000,000원 |';
    expect(guard(table)).toBe(table);
    expect(stream(`${table}\n`)).toEqual({ out: `${table}\n`, blocked: false });
  });
});

describe('강조·코드·링크·HTML 기호 우회', () => {
  it.each([
    ['굵은 금액', '원가는 **1,000**원입니다.'],
    ['코드 금액', '원가는 `1,000`원입니다.'],
    ['단어 가운데 강조', '원**가** 1,000원'],
    ['밑줄 강조', '__원가__ 1,000원'],
    ['취소선', '~~원~~가 1,000원'],
    ['링크 글자', '[원가](/calculator) 1,000원'],
    ['이미지 alt', '![원가](/x.png) 1,000원'],
    ['원문 HTML 태그(렌더하지 않아 글자만 붙음)', '<b>원</b>가 1,000원'],
    ['숫자 문자 참조', '&#50896;가 1,000원'],
    ['16진 문자 참조', '&#xC6D0;가 1,000원'],
    ['이름 참조 쉼표', '원가 1&comma;000원'],
    ['역슬래시 이스케이프', '원가 1\\,000\\*원'],
    ['제목 접두', '### 원가 1,000원'],
    ['목록 접두', '- **원가**: 1,000원'],
    ['인용 접두', '> 원가 1,000원'],
    ['태그가 아닌 꺾쇠 글(화면에 그대로 보임)', '원가 <1,000원>'],
  ])('%s → 차단 (최종·토큰 가드)', (_label, text) => {
    expect(mentionsCostAmount(text)).toBe(true);
    expect(guard(text)).toBe(COST_REPLY);
    expect(stream(`${text}\n`).blocked).toBe(true);
  });

  it('stripMarkdown 은 보이는 글자만 남긴다', () => {
    expect(stripMarkdown('**1,000**원')).toBe('1,000원');
    expect(stripMarkdown('`1,000`원')).toBe('1,000원');
    expect(stripMarkdown('| A | B |')).toBe('  A   B  ');
    expect(stripMarkdown('[보기](/pricing)')).toBe('보기');
    expect(stripMarkdown('### 제목')).toBe('제목');
    expect(stripMarkdown('<b>굵게</b>')).toBe('굵게');
    expect(stripMarkdown('<1,000원>')).toBe('<1,000원>');
  });

  it('원가 키 JSON 은 서식 제거 전 원문으로도 잡는다 (`unit_cost` 의 _)', () => {
    expect(mentionsCostAmount('{"unit_cost": 1}')).toBe(true);
    expect(mentionsCostAmount('`purchase_price = 1`')).toBe(true);
  });
});

describe('조달 외부 이름 가림 (maskTerms 는 기호 제거 뒤)', () => {
  const TITLE = '원가 분석 시스템 구축';

  it('**공고명** 이어도 가림 유지 — 예산 문장이 원가 문장으로 오인되지 않는다', () => {
    const text = `**${TITLE}** 공고의 배정예산은 300,000,000원입니다.`;
    expect(mentionsCostAmount(text, [TITLE])).toBe(false);
    expect(guard(text, [TITLE])).toBe(text);
    expect(stream(text, [TITLE]).blocked).toBe(false);
  });

  it('표 칸의 공고명도 가림 유지', () => {
    const table = `| 공고명 | 배정예산 |\n|---|---|\n| ${TITLE} | 300,000,000원 |`;
    expect(mentionsCostAmount(table, [TITLE])).toBe(false);
  });

  it('가림은 이름에만 — 이름 밖의 원가 단어 + 금액은 그대로 차단', () => {
    expect(mentionsCostAmount(`**${TITLE}** 의 원가는 1,000원`, [TITLE])).toBe(true);
  });

  it('외부 문구의 `|` 는 전각 ｜ 로 바뀌어 표 칸을 가르지 않고, 가림은 그대로 맞는다', () => {
    const raw = 'E2E 가상 | 공고 [x](https://evil.example) `코드`';
    const clipped = clipText(raw, 120)!;
    expect(clipped).toBe('E2E 가상 ｜ 공고 [x](https://evil.example) `코드`');
    expect(clipped).not.toContain('|');
    const text = `| 공고명 | 원가 |\n|---|---|\n| ${clipped} | 판매 |`;
    // 공고명 칸에 원가·금액이 없으면 통과, 가림도 정확히 맞는다(NFKC 가 판정용 사본에서 ｜ → |)
    expect(mentionsCostAmount(text, [clipped])).toBe(false);
  });
});

describe('길이 상한', () => {
  it('REPLY_MAX_LENGTH = 2000 (마크다운 기호 몫)', () => {
    expect(REPLY_MAX_LENGTH).toBe(2000);
    const long = `${'가'.repeat(2100)}`;
    expect(guard(long).startsWith('가'.repeat(2000))).toBe(true);
    expect(guard(long).length).toBeLessThan(2100);
  });
});
