import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatMarkdown } from '@/features/chat/ChatMarkdown';
import { closeOpenFence, escapeMarkdownText, internalHref } from '@/lib/chat/markdown';

/** 챗봇 답변 마크다운 렌더 (docs/specs/chat-markdown.md §2.2·§2.5·§3) — 합성 문구 */
function renderMd(text: string, streaming = false) {
  const { container } = render(<ChatMarkdown text={text} streaming={streaming} />);
  return container.querySelector('[data-markdown]') as HTMLElement;
}

describe('요소 렌더', () => {
  it('###·굵게·목록·GFM 표·인라인/블록 코드·인용·구분선', () => {
    const root = renderMd(
      [
        '# 큰 제목',
        '### 조회 결과',
        '- **Wapples-500** `12,000,000`',
        '1. 첫째',
        '',
        '| 품목 | 판매가 |',
        '|---|---:|',
        '| A | 1,000원 |',
        '',
        '> 인용 문장',
        '',
        '```',
        'code block',
        '```',
        '',
        '---',
        '~~취소~~ *기울임*',
      ].join('\n'),
    );
    // 제목 상한: h1 → h3(16px), h3 → h4(14px) — 페이지 h1 을 넘지 않는다
    expect(root.querySelector('h1')).toBeNull();
    expect(within(root).getByRole('heading', { level: 3, name: '큰 제목' })).toHaveClass(
      'text-[16px]',
    );
    expect(within(root).getByRole('heading', { level: 4, name: '조회 결과' })).toHaveClass(
      'text-[14px]',
    );
    expect(root.querySelector('strong')).toHaveTextContent('Wapples-500');
    expect(root.querySelector('ul li')).toBeInTheDocument();
    expect(root.querySelector('ol li')).toHaveTextContent('첫째');
    expect(root.querySelector('li code')).toHaveTextContent('12,000,000');
    expect(root.querySelector('pre code')).toHaveTextContent('code block');
    expect(root.querySelector('blockquote')).toHaveTextContent('인용 문장');
    expect(root.querySelector('hr')).toBeInTheDocument();
    expect(root.querySelector('del')).toHaveTextContent('취소');
    expect(root.querySelector('em')).toHaveTextContent('기울임');

    // 표: 가로 스크롤 래퍼는 키보드로 포커스 가능한 region, 머리 칸은 scope=col
    const region = within(root).getByRole('region', { name: '표' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-x-auto');
    const table = within(region).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.getAttribute('scope')),
    ).toEqual(['col', 'col']);
    expect(within(table).getByRole('cell', { name: '1,000원' })).toHaveStyle({
      textAlign: 'right',
    });
  });

  it('옛 평문 답변(줄바꿈 1개)은 재열람해도 줄바꿈 유지 (remark-breaks)', () => {
    const root = renderMd('첫 줄\n둘째 줄');
    expect(root.querySelectorAll('br')).toHaveLength(1);
    expect(root.querySelector('p')?.textContent).toBe('첫 줄\n둘째 줄');
  });
});

describe('보안 — 원문 HTML·위험 링크·이미지', () => {
  it('원문 HTML(<script>·<img onerror>·<a href>)은 요소로 렌더되지 않는다', () => {
    const root = renderMd(
      '앞 <script>alert(1)</script> 뒤\n\n<img src=x onerror="alert(1)">\n\n<a href="https://evil.example">악성</a>',
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('a')).toBeNull();
    expect(root.innerHTML).not.toMatch(/onerror|<script/i);
  });

  it.each([
    ['javascript:', '[누르기](javascript:alert(1))'],
    ['data:', '[누르기](data:text/html;base64,PHNjcmlwdD4=)'],
    ['vbscript:', '[누르기](vbscript:msgbox(1))'],
    ['외부 https', '[누르기](https://evil.example/x)'],
    ['외부 http', '[누르기](http://evil.example/x)'],
    ['프로토콜 상대', '[누르기](//evil.example/x)'],
    ['mailto:', '[누르기](mailto:a@example.invalid)'],
    ['자동 링크', 'https://evil.example/x'],
  ])('%s 링크는 <a> 없이 글자', (_label, text) => {
    const root = renderMd(text);
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toMatch(/누르기|evil\.example/);
  });

  it('내부 경로(/…)만 <a> — 같은 탭, 링크 색·포커스 고리', () => {
    const root = renderMd('[계산기 열기](/calculator?family=WAPPLES)');
    const link = within(root).getByRole('link', { name: '계산기 열기' });
    expect(link).toHaveAttribute('href', '/calculator?family=WAPPLES');
    expect(link).not.toHaveAttribute('target');
    expect(link).toHaveClass('text-link', 'focus-visible:outline-focus-ring');
  });

  it('![](http…) 원격 이미지는 <img> 없이 alt 글자만', () => {
    const root = renderMd(
      '![합성 그림](https://evil.example/a.png) 그리고 ![](https://evil.example/b.png)',
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root).toHaveTextContent('합성 그림 그리고');
  });

  it('조달 외부 문구(합성) 속 [x](https://evil)·|·백틱: 링크 생성 없음, 표 칸 수 그대로', () => {
    // clipText 가 | 를 전각 ｜ 로 바꾼 공고명이 표 칸에 그대로 들어간 모델 답
    const title = 'E2E 가상 ｜ 공고 [x](https://evil.example) `코드`';
    const root = renderMd(`| 공고명 | 적합도 |\n|---|---|\n| ${title} | 상 |`);
    expect(root.querySelector('a')).toBeNull();
    const row = within(root).getAllByRole('row')[1]!;
    expect(within(row).getAllByRole('cell')).toHaveLength(2);
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('E2E 가상 ｜ 공고 x 코드');
  });
});

describe('스트리밍 중간 문자열', () => {
  it('미완성 코드펜스: 예외 없이 렌더, 펜스를 임시로 닫아 뒤 글이 코드에 삼켜지지 않는다', () => {
    const root = renderMd('앞 문장\n\n```\nconst a = 1', true);
    expect(root.querySelector('pre code')).toHaveTextContent('const a = 1');
    expect(root).toHaveTextContent('앞 문장');
  });

  it('미완성 표(머리행만·구분 행까지)도 예외 없이 문단/표로 렌더', () => {
    expect(renderMd('| 품목 | 판매가 |', true)).toHaveTextContent('품목');
    const partial = renderMd('| 품목 | 판매가 |\n|---|---|\n| A |', true);
    expect(partial.querySelector('table')).toBeInTheDocument();
  });

  it('closeOpenFence: 열린 펜스만 같은 펜스로 닫는다', () => {
    expect(closeOpenFence('a\n```\nb')).toBe('a\n```\nb\n```');
    expect(closeOpenFence('a\n````\nb\n```\n')).toBe('a\n````\nb\n```\n````');
    expect(closeOpenFence('a\n```\nb\n```')).toBe('a\n```\nb\n```');
    expect(closeOpenFence('~~~\nx')).toBe('~~~\nx\n~~~');
    expect(closeOpenFence('평문')).toBe('평문');
  });
});

describe('규칙 응답 이스케이프·내부 링크 판정', () => {
  it('escapeMarkdownText: 품명·검색어의 기호가 서식이 되지 않고 글자 그대로 보인다', () => {
    const raw =
      '"**굵게** [x](/admin) | a | _밑줄_ <b>" 에 해당하는 품목을 찾지 못했습니다.\n# 제목 아님\n1. 목록 아님';
    const root = renderMd(escapeMarkdownText(raw));
    expect(root.querySelector('strong, em, a, h1, h3, h4, ol, table')).toBeNull();
    const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
    expect(flat(root.textContent ?? '')).toBe(flat(raw));
  });

  it('internalHref', () => {
    expect(internalHref('/pricing')).toBe('/pricing');
    expect(internalHref('//evil.example')).toBeNull();
    expect(internalHref('/\\evil.example')).toBeNull();
    expect(internalHref('https://example.invalid')).toBeNull();
    expect(internalHref('javascript:alert(1)')).toBeNull();
  });
});
