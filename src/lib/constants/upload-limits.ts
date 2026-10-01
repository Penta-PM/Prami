/**
 * 임포트 업로드 상한 (PRAMI-001 §4.4.1, PRAMI-003 §4.2.3). 서버 검증·Route 413·proxy 본문 상한·브라우저 사전 확인이 같은 값을 쓴다.
 * 브라우저 번들에도 들어가므로 서버 전용 모듈을 import 하지 않는다.
 */
const MB = 1024 * 1024;

/** 파일당 상한 (모든 종류) */
export const MAX_IMPORT_FILE_BYTES = 10 * MB;
/** 품목조회 한 배치의 파일 수·합계 상한 */
export const MAX_ITEM_FILES = 5;
export const MAX_ITEM_TOTAL_BYTES = 25 * MB;
/** multipart 경계·헤더 여유분 — Content-Length 사전 확인에서 파일 크기 합에 더한다 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/**
 * proxy(1차 방어)가 버퍼링하는 요청 본문 상한(next.config `experimental.proxyClientMaxBodySize`).
 * proxy 는 이 값을 넘는 본문을 잘라 Route 의 multipart 파싱을 실패시키므로(QA M-2), 가장 큰 업로드(품목 합계 25MB)
 * + multipart 여유보다 크게 둔다. 그 사이 구간은 Route 가 Content-Length 로 먼저 413 을 낸다.
 */
export const PROXY_BODY_LIMIT_BYTES = MAX_ITEM_TOTAL_BYTES + MB;

export const TOO_LARGE_FILE_MESSAGE = '파일은 10MB 이하만 업로드할 수 있습니다';
export const TOO_LARGE_ITEM_TOTAL_MESSAGE = '품목조회 파일 합계는 25MB 이하만 업로드할 수 있습니다';
/** 앱 밖(플랫폼·프록시)에서 413 이 JSON 봉투 없이 돌아온 경우 — Vercel 함수 요청 본문 한도(4.5MB) 등 */
export const PLATFORM_TOO_LARGE_MESSAGE =
  '업로드 크기가 서버 허용 한도를 넘었습니다(413). 파일 수를 줄이거나 더 작은 파일로 나눠 다시 업로드하세요';

/** 브라우저 사전 확인: 업로드 전에 개수·크기 상한을 알려 준다 (서버 검증과 같은 순서·문구). 통과면 null */
export function checkUploadFiles(
  files: readonly { size: number }[],
  multiple: boolean,
): string | null {
  if (multiple && files.length > MAX_ITEM_FILES) {
    return `품목조회 파일은 한 번에 ${MAX_ITEM_FILES}개까지입니다`;
  }
  if (files.some((file) => file.size > MAX_IMPORT_FILE_BYTES)) return TOO_LARGE_FILE_MESSAGE;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (multiple && total > MAX_ITEM_TOTAL_BYTES) return TOO_LARGE_ITEM_TOTAL_MESSAGE;
  return null;
}
