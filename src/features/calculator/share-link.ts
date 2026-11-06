/**
 * 견적 공유 링크 보내기 (모바일 UI 스펙 §9 MOB-DS-103): 브라우저 공유(`navigator.share`)를 기능 감지로 쓰고,
 * 사용자가 공유 창을 닫으면(AbortError) 조용히 끝내고, 그 밖의 오류는 클립보드 복사로 대체한다.
 * 공유 텍스트에는 금액을 넣지 않는다(제목·URL 만). 화면 폭이 아니라 기능으로 판단한다.
 */

/** 공유에 쓰는 navigator 부분 — 테스트에서 주입한다 */
export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/** shared: 공유 창에서 보냄 · aborted: 사용자가 닫음(메시지 없음) · copied: 대체 복사 성공 · failed: 복사도 실패 */
export type ShareOutcome = 'shared' | 'aborted' | 'copied' | 'failed';

export function canNativeShare(nav: ShareNavigator | undefined): boolean {
  return typeof nav?.share === 'function';
}

export function shareTitle(quoteNo: string): string {
  return `Prami 견적서 ${quoteNo}`;
}

export async function copyLink(nav: ShareNavigator | undefined, url: string): Promise<boolean> {
  try {
    if (!nav?.clipboard) return false;
    await nav.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export async function shareOrCopy(
  nav: ShareNavigator | undefined,
  { title, url }: { title: string; url: string },
): Promise<ShareOutcome> {
  if (canNativeShare(nav)) {
    try {
      await nav!.share!({ title, url });
      return 'shared';
    } catch (error) {
      // DOMException 은 환경에 따라 Error 를 상속하지 않는다 — 이름으로 본다
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return 'aborted';
    }
  }
  return (await copyLink(nav, url)) ? 'copied' : 'failed';
}
