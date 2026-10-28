import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_USER, loginAs } from './helpers';

/**
 * PR-10 챗봇 (AC-80~82, QA-10): 가격 정책 챗봇 화면(UX PR-C2 — 헤더 버튼·도킹 패널 대체)에서 새 대화 → 4개 의도(가격·연도 비교·견적·원가)
 * + 매칭 실패, 견적 시작 링크로 계산기에 품목이 선택된 채 이동, 비로그인 POST /api/chat 401.
 */
async function ask(page: Page, text: string): Promise<string> {
  const log = page.getByRole('log', { name: '대화' });
  const before = await log.locator('[data-from="bot"]').count();
  await page.getByLabel('질문 입력').fill(text);
  await page.getByRole('button', { name: '보내기' }).click();
  const bubble = log.locator('[data-from="bot"]').nth(before);
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toContainText('답변을 쓰는 중…');
  return bubble.innerText();
}

test('USER: 챗봇 화면 새 대화 → 가격 조회 → 연도 비교 → 원가 거부 → 도움말 → 견적 시작 링크로 계산기 이동', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  await page.getByRole('button', { name: '새 대화' }).click();
  const panel = page.getByRole('main');
  await expect(panel).toContainText('원가 데이터는 표시되지 않습니다');
  await expect(panel.getByRole('log', { name: '대화' })).toContainText('무엇이든 물어보세요');
  await expect(panel.getByRole('group', { name: '예시 질문' })).toBeVisible();

  // AC-80 가격 조회: 값은 DB (sales-200 픽스처의 Wapples-500 (H500 T2) = 12,000,000원)
  const price = await ask(page, 'Wapples-500 (H500 T2) 가격 알려줘');
  // 말풍선 텍스트(작성 시각은 말풍선 밖 <time>)
  expect(price).toMatch(
    /^\d{4}년 기준 WAPPLES Wapples-500 \(H500 T2\)의 가격은 12,000,000원입니다\./,
  );
  await expect(panel.getByRole('link', { name: /이 품목으로 견적 시작/ })).toHaveAttribute(
    'href',
    '/calculator?family=WAPPLES&item=P10100015',
  );

  // AC-80 연도 비교 (이전 적용 행이 없는 품목은 안내 문장)
  const compare = await ask(page, 'Wapples-500 (H500 T2) 작년보다 올랐어?');
  expect(compare).toMatch(
    /전년 대비 약 [\d.]+% (상승|하락)|이전 적용 가격 데이터가 없어|같은 금액/,
  );

  // AC-81 USER 원가 → 거부 문구
  const cost = await ask(page, 'Wapples-500 원가 알려줘');
  expect(cost).toBe(
    '원가 정보는 관리자만 조회할 수 있습니다. 대신 견적 계산기에서 예상 견적 금액을 확인해보세요.',
  );
  expect(await panel.innerText()).not.toMatch(/원가[:：]\s*[\d,]+/);

  // AC-82 매칭 실패 → 도움말 + 예시
  const help = await ask(page, '오늘 점심 뭐 먹지');
  expect(help).toContain('아직 학습 중인 질문이에요');
  expect(help).toContain('작년보다 올랐어?');

  // 견적 시작: 제품 퀵칩 → 품목 → 계산기로 이동해 품목이 선택돼 있다
  await ask(page, '견적 뽑아줘');
  await expect(panel.getByRole('group', { name: '제품 선택' })).toBeVisible();
  await panel
    .getByRole('group', { name: '제품 선택' })
    .getByRole('button', { name: 'WAPPLES' })
    .click();
  await expect(panel.locator('[data-from="bot"]').last()).toContainText(
    'WAPPLES 견적을 시작합니다',
  );
  await expect(panel.locator('[data-from="bot"]').last()).not.toContainText('답변을 쓰는 중…');
  await ask(page, 'Wapples-500 (H500 T2) 견적 뽑아줘');
  await panel.getByRole('link', { name: /견적 계산기에서 이어서 선택/ }).click();
  await expect(page).toHaveURL(/\/calculator\?family=WAPPLES&item=P10100015$/);
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    '챗봇에서 넘어온 품목을 선택했습니다: Wapples-500 (H500 T2)',
  );
  await expect(page.getByTestId('pre-discount')).toContainText('12,000,000원');
  await expect(
    page.getByRole('button', { name: /장바구니에 담기 \(Wapples-500 \(H500 T2\) × 1\)/ }),
  ).toBeEnabled();
});

test('비로그인 POST /api/chat → 401, 로그인 후 200 봉투에 원가 키 없음', async ({
  page,
  request,
}) => {
  const anonymous = await request.post('/api/chat', { data: { message: '가격' } });
  expect(anonymous.status()).toBe(401);
  await loginAs(page, FIXTURE_USER, '/');
  const response = await page.request.post('/api/chat', {
    data: { message: 'Wapples-500 (H500 T2) 가격' },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, data: { intent: 'price' } });
  expect(JSON.stringify(body)).not.toMatch(/unit_cost|unitCost|material_costs/);
});
