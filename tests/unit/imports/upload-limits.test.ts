import { describe, expect, it } from 'vitest';

import {
  checkUploadFiles,
  MAX_IMPORT_FILE_BYTES,
  MAX_ITEM_TOTAL_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  PROXY_BODY_LIMIT_BYTES,
} from '@/lib/constants/upload-limits';

/** PRAMI-003 QA M-2 — 업로드 상한(파일당 10MB·합계 25MB·5개)과 proxy 본문 상한의 관계 */
describe('upload-limits', () => {
  it('proxy 본문 상한은 가장 큰 업로드(품목 합계 25MB) + multipart 여유보다 크다 — Route 413 이 먼저 난다', () => {
    expect(MAX_ITEM_TOTAL_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_IMPORT_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(PROXY_BODY_LIMIT_BYTES).toBeGreaterThan(MAX_ITEM_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES);
  });

  it('checkUploadFiles: 경계값 — 10MB·합계 25MB 는 통과, 1바이트 초과는 안내', () => {
    const f = (size: number) => ({ size });
    expect(checkUploadFiles([f(MAX_IMPORT_FILE_BYTES)], false)).toBeNull();
    expect(checkUploadFiles([f(MAX_IMPORT_FILE_BYTES + 1)], false)).toContain('10MB');
    const ten = f(MAX_IMPORT_FILE_BYTES);
    expect(checkUploadFiles([ten, ten, f(5 * 1024 * 1024)], true)).toBeNull();
    expect(checkUploadFiles([ten, ten, f(5 * 1024 * 1024 + 1)], true)).toContain('25MB');
    expect(checkUploadFiles([1, 2, 3, 4, 5].map(f), true)).toBeNull();
    expect(checkUploadFiles([1, 2, 3, 4, 5, 6].map(f), true)).toContain('5개');
  });
});
