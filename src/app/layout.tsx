import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { MotionProvider } from '@/components/motion/MotionProvider';

import './globals.css';

/**
 * Pretendard 셀프 호스트 (Penta 디자인 토큰 PR-1): 공식 npm pretendard@1.3.9 의 가변 폰트(전체 글리프, OFL — ./fonts/OFL.txt).
 * 외부 CDN 요청 0 — CSP 에 폰트 출처를 따로 두지 않는다. `--font-pretendard` 를 <html> 에 달고 globals.css 의 --font-body 가 참조한다.
 * 견적서 PDF 의 NotoSansKR(src/assets/fonts)과는 별개다.
 */
const pretendard = localFont({
  src: './fonts/PretendardVariable.woff2',
  weight: '45 920',
  style: 'normal',
  display: 'swap',
  variable: '--font-pretendard',
});

export const metadata: Metadata = {
  title: { default: 'Prami — 가격정책 통합 관리', template: '%s | Prami' },
  description: '펜타시큐리티 제품군의 판매단가·원가·파츠·견적 정보를 통합 관리합니다.',
  icons: { icon: '/logo-prami-mark.png' },
};

/**
 * 모든 경로를 요청 시점에 렌더한다 (PR-11a QA M-1). 정적 프리렌더 HTML(예: 기본 /_not-found)에는 요청별 CSP nonce 를
 * 넣을 수 없어 `script-src 'nonce-…' 'strict-dynamic'` 아래에서 스크립트가 전부 차단된다. `connection()` 은 이 레이아웃을
 * 쓰는 모든 페이지(404·에러 포함)를 동적으로 만든다 — 앱 화면은 원래 전부 로그인 세션 기반의 동적 렌더라 비용이 거의 없다.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="antialiased">
        {/* 모션 Provider 는 루트에 둬 (app) 밖의 /login·/share 에도 적용한다 (Motion 도입 스펙 §3.2) */}
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
