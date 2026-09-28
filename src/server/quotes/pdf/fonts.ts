import path from 'node:path';

import { Font } from '@react-pdf/renderer';

/**
 * 견적서 PDF 한글 폰트 (§4.5.8): Noto Sans KR 서브셋 (KS X 1001 완성형 2,350자 + 라틴·기호), OFL 1.1.
 * 원본 https://github.com/notofonts/noto-cjk (Sans/Variable/TTF/Subset/NotoSansKR-VF.ttf) 를 fontTools 로
 * wght 400/700 정적화 후 서브셋 — 라이선스 전문은 src/assets/fonts/OFL.txt. 파일은 저장소에 포함하므로 외부 요청이 없다.
 * Vercel 서버리스에서는 next.config `outputFileTracingIncludes` 로 함께 배포된다.
 */
export const QUOTE_FONT_FAMILY = 'NotoSansKR';

export const FONT_DIR = path.join(process.cwd(), 'src', 'assets', 'fonts');

export const QUOTE_FONT_FILES = {
  regular: path.join(FONT_DIR, 'NotoSansKR-Regular-subset.ttf'),
  bold: path.join(FONT_DIR, 'NotoSansKR-Bold-subset.ttf'),
} as const;

let registered = false;

/** 프로세스당 1회 등록 (react-pdf 의 Font 레지스트리는 전역) */
export function registerQuoteFonts(): void {
  if (registered) return;
  Font.register({
    family: QUOTE_FONT_FAMILY,
    fonts: [
      { src: QUOTE_FONT_FILES.regular, fontWeight: 400 },
      { src: QUOTE_FONT_FILES.bold, fontWeight: 700 },
    ],
  });
  // 한글·품번 중간에서 하이픈 줄바꿈이 생기지 않도록 단어 단위로만 줄을 바꾼다
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
