import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * PRAMI-003 PR-1 QA M-2 — 품목조회 업로드 상한(파일당 10MB·합계 25MB, §4.2.3)이 실제 서버(proxy 포함)에서 성립한다.
 * 수정 전에는 proxy 본문 상한(11MB)이 합계 11~25MB 본문을 잘라 "업로드 본문을 읽을 수 없습니다"(400)가 났다.
 * 본문 전체가 Route 에 닿았는지는 파일 단위 검증 결과(확장자 오류·합계 413)로 확인한다 — 파싱·배치 생성 전에 끝나 DB 를 바꾸지 않는다.
 */
const MB = 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BODY_UNREADABLE = '업로드 본문을 읽을 수 없습니다';

type Part = { name: string; size: number };

function postItems(page: Page, parts: readonly Part[]) {
  const body = new FormData();
  for (const part of parts) {
    body.append('files', new Blob([Buffer.alloc(part.size, 0x41)], { type: XLSX_MIME }), part.name);
  }
  return page.request.post('/api/imports/items', { multipart: body, timeout: 60_000 });
}

test('ADMIN: 품목조회 합계 25MB 경계 — 25MB 는 Route 까지 도달, 25MB+1B·26MB 는 413 합계 안내', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_ADMIN, '/admin/policies');

  // 합계 정확히 25MB(10+10+5): 본문이 잘리지 않고 파일 검증까지 간다 → 마지막 파일 확장자 오류(배치 미생성)
  const exact = await postItems(page, [
    { name: 'a.xlsx', size: 10 * MB },
    { name: 'b.xlsx', size: 10 * MB },
    { name: 'c.csv', size: 5 * MB },
  ]);
  const exactJson = await exact.json();
  expect(exact.status(), JSON.stringify(exactJson)).toBe(400);
  expect(exactJson.error.message).not.toContain(BODY_UNREADABLE);
  expect(exactJson.error).toMatchObject({
    code: 'VALIDATION',
    message: '엑셀(.xlsx) 파일만 업로드할 수 있습니다',
  });

  // 합계 25MB + 1B: Content-Length 는 multipart 여유 안 → Route 가 파일 크기 합으로 413
  const overByOne = await postItems(page, [
    { name: 'a.xlsx', size: 10 * MB },
    { name: 'b.xlsx', size: 10 * MB },
    { name: 'c.xlsx', size: 5 * MB + 1 },
  ]);
  expect(overByOne.status()).toBe(413);
  expect((await overByOne.json()).error).toMatchObject({
    code: 'PAYLOAD_TOO_LARGE',
    message: '품목조회 파일 합계는 25MB 이하만 업로드할 수 있습니다',
  });

  // 합계 26MB: Content-Length 사전 확인 413 (L-1 — 10MB 가 아니라 합계 문구)
  const over = await postItems(page, [
    { name: 'a.xlsx', size: 10 * MB },
    { name: 'b.xlsx', size: 10 * MB },
    { name: 'c.xlsx', size: 6 * MB },
  ]);
  expect(over.status()).toBe(413);
  expect((await over.json()).error.message).toBe(
    '품목조회 파일 합계는 25MB 이하만 업로드할 수 있습니다',
  );
});
