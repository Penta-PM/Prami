import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import './globals.css';

/**
 * 디자인 토큰(typography.css)이 지정한 Pretendard 웹폰트. 토큰 파일의 @import 와 동일 URL(버전 고정).
 * SRI 해시로 내용을 고정한다 — 불일치 시 폰트만 시스템 폰트로 대체되고 화면은 정상 동작한다.
 * 셀프 호스팅(폰트 파일 저장소 보관)은 후속 PR 에서 검토한다.
 */
const PRETENDARD_CSS_URL =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css';
const PRETENDARD_CSS_INTEGRITY =
  'sha384-SN6A48CJQjx946+DRb8wsoifC4a8ur9ZS6R+HCTgnBHOKCa6GLXAR3Qn8d1jztxg';

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
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href={PRETENDARD_CSS_URL}
          integrity={PRETENDARD_CSS_INTEGRITY}
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
