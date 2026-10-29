/**
 * 챗봇 답변 마크다운 보조 (docs/specs/chat-markdown.md) — 서버(규칙 응답 이스케이프)·클라이언트(렌더) 공용 순수 함수.
 */

/** 인라인 서식·링크·표·HTML 이 될 수 있는 글자 */
const INLINE_SPECIAL = /[\\`*_[\]<>|~]/g;
/** 줄 첫머리에서 제목·인용·목록이 되는 접두 (`#`·`>`·`-`·`+`·`1.`·`1)`) */
const LINE_START_SPECIAL = /^(\s*)(#|>|[-+](?=\s)|\d+(?=[.)]\s))/gm;

/**
 * 규칙 응답(mode: rule)을 마크다운 렌더에서 글자 그대로 보이게 이스케이프한다 (§2.4).
 * 품명·품번·사용자 검색어(`"${query}" 에 해당하는…`)가 굵게·링크·표로 바뀌지 않게. 줄바꿈은 그대로 둔다(remark-breaks).
 */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(INLINE_SPECIAL, (char) => `\\${char}`)
    .replace(LINE_START_SPECIAL, (_whole, indent: string, mark: string) =>
      /^\d/.test(mark) ? `${indent}${mark}\\` : `${indent}\\${mark}`,
    );
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 스트리밍 중간 문자열에 열린 코드펜스가 있으면 같은 펜스로 임시로 닫는다 (§2.5) — 뒤 텍스트가 코드로 삼켜진 채 깜빡이지 않게.
 * 펜스 안의 짧은 펜스·다른 문자 펜스는 닫는 펜스가 아니다(CommonMark). `final` 이 오면 원문 전체로 바뀐다.
 */
export function closeOpenFence(text: string): string {
  let open: string | null = null;
  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line)?.[1];
    if (!fence) continue;
    if (open === null) open = fence;
    else if (
      fence[0] === open[0] &&
      fence.length >= open.length &&
      !line.trim().slice(fence.length)
    )
      open = null;
  }
  return open === null ? text : `${text}${text.endsWith('\n') ? '' : '\n'}${open}`;
}

/** 내부 경로(`/…`, `//` 제외)만 링크로 — 외부 http(s)·javascript:·data:·vbscript:·mailto: 등은 링크로 만들지 않는다 (§2.2) */
export function internalHref(url: string): string | null {
  const href = url.trim();
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\') ? href : null;
}
