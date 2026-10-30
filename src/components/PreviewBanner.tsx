import { previewBannerText } from '@/server/dev/preview';

/**
 * :3000 미리보기 띠 (docs/specs/preview-on-3000.md §6): 개발 서버가 main 이 아닌 커밋을 보여 줄 때만 화면 맨 위에 한 줄.
 * warning-50 바탕 + warning-800 글자(AA), 14px, 높이 28px, 닫기 없음. production 에서는 아무것도 그리지 않는다.
 */
export function PreviewBanner() {
  const text = previewBannerText();
  if (!text) return null;
  return (
    <div
      role="status"
      data-preview-banner=""
      className="flex h-7 items-center justify-center bg-warning-50 px-4 text-[14px] leading-5 font-semibold whitespace-nowrap text-warning-800 shadow-(--hairline-subtle)"
    >
      {text}
    </div>
  );
}
