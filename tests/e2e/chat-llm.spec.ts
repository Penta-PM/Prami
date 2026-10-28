import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * PRAMI-002 PR-B (QA-B ①②, AC-222): 키 없는 USER → 챗봇 화면 배너·설정 링크, 질문은 규칙 답 + 짧은 안내.
 * 설정 링크로 같은 탭에서 설정 화면에 가 fake 키를 저장한 뒤 뒤로 가기로 돌아오면(UX PR-C2 — 도킹 패널 대신 화면, 대화는 `?c=` 로
 * DB 에서 복원) 상태를 다시 읽어 같은 질문이 LLM 경로(fake 모델)로 답한다. 실벤더 호출 없음(LLM_VENDOR_MODE=fake).
 * 다른 스펙(PR-10 chat.spec)이 규칙 경로로 돌도록 시작·끝에 픽스처 사용자의 LLM 자격 증명과 저장 대화를 지운다.
 */
async function clearCredentials() {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    const users = `select id from users where email in ($1, $2)`;
    for (const table of ['user_llm_credentials', 'user_settings', 'chat_conversations']) {
      await client.query(`delete from ${table} where user_id in (${users})`, [
        FIXTURE_USER,
        FIXTURE_ADMIN,
      ]);
    }
  } finally {
    await client.end();
  }
}

async function ask(page: Page, text: string) {
  const log = page.getByRole('log', { name: '대화' });
  const before = await log.locator('[data-from="bot"]').count();
  await page.getByLabel('질문 입력').fill(text);
  await page.getByRole('button', { name: '보내기' }).click();
  const bubble = log.locator('[data-from="bot"]').nth(before);
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toContainText('답변을 쓰는 중…');
  return bubble;
}

/**
 * PRAMI-003 AC-374 (PR #20 QA I-3 플레이크 원인): E2E 는 `next dev` 라 라우트를 처음 요청할 때 컴파일한다. 파일 이름 순서상
 * 이 스펙이 `/api/chat`(LangGraph·LangChain 번들 — 가장 무거운 라우트)을 처음 부르므로, 첫 질문 말풍선 대기(15초)가 컴파일
 * 시간까지 떠안아 부하에서 간헐 실패했다. 재시도 대신 화면 검사 전에 같은 세션으로 라우트를 한 번 불러 컴파일을 끝내 둔다.
 */
async function warmUpChatRoute(page: Page) {
  const status = await page.request.get('/api/chat/status', { timeout: 120_000 });
  expect(status.status()).toBe(200);
  const warm = await page.request.post('/api/chat', {
    data: { message: '워밍업', history: [] },
    timeout: 120_000,
  });
  expect(warm.status()).toBe(200);
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(clearCredentials);
test.afterAll(clearCredentials);

test('키 없음 → 배너·안내·규칙 답, 설정 링크로 fake 키 저장 → 돌아오면 같은 대화에서 LLM 경로', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  await warmUpChatRoute(page);
  const main = page.getByRole('main');
  const banner = main.getByRole('status', { name: 'LLM 연결 안내' });
  await expect(banner).toContainText('LLM API 키가 등록되지 않았습니다');
  await expect(banner.getByRole('link', { name: /사용자 설정에서 등록하기/ })).toHaveAttribute(
    'href',
    '/settings#llm',
  );
  await expect(main.getByRole('log', { name: '대화' })).toContainText('무엇이든 물어보세요');

  // 규칙 답 (AC-80 ① 후보 병기) + 짧은 안내 (긴 안내는 배너 한 곳)
  const rule = await ask(page, 'Wapples-500 가격');
  await expect(rule).toContainText('Wapples-500 (H500 T2) 12,000,000원');
  await expect(rule).toContainText('LLM 미연결 — 기본 응답');
  await expect(page).toHaveURL(/\/pricing\/chat\?c=/);
  const chatUrl = page.url();

  // 배너의 설정 링크(같은 탭)로 가서 키 등록 → 뒤로 가기
  await banner.getByRole('link', { name: /사용자 설정에서 등록하기/ }).click();
  await expect(page).toHaveURL(/\/settings/);
  const card = page.getByRole('article', { name: 'Anthropic (Claude) 연결' });
  await card.getByRole('button', { name: '등록' }).click();
  await card.getByLabel(/API 키/).fill(`fake-valid-${randomBytes(12).toString('hex')}`);
  await card.getByRole('button', { name: '저장하고 검증' }).click();
  await expect(page.getByTestId('status-anthropic')).toHaveText('정상');
  await page.goBack();
  await expect(page).toHaveURL(chatUrl);
  // 같은 대화가 DB 에서 복원된다
  await expect(
    page.getByRole('log', { name: '대화' }).locator('[data-from="bot"]').first(),
  ).toContainText('12,000,000원');

  const llm = await ask(page, 'Wapples-500 가격');
  await expect(llm).toContainText('[fake LLM] 조회 결과');
  await expect(llm).not.toContainText('LLM 미연결');
  // 응답의 llm 상태로 배너가 사라지고 과금 고지가 보인다
  await expect(banner).toHaveCount(0);
  await expect(main.getByRole('note', { name: '과금 안내' })).toContainText('본인 벤더 계정');

  // AC-243: LLM 연결 상태의 다음 질문은 SSE(event-stream)로 점진 수신 — CSP 헤더는 JSON 응답과 같다(요청별 nonce 제외)
  const sseResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/chat') && response.request().method() === 'POST',
  );
  const streamed = await ask(page, 'Wapples-500 가격');
  const response = await sseResponse;
  expect(response.request().headers()['accept']).toBe('text/event-stream');
  expect(response.headers()['content-type']).toContain('text/event-stream');
  await expect(streamed).toContainText('[fake LLM] 조회 결과');
  const json = await page.request.post('/api/chat', { data: { message: 'Wapples-500 가격' } });
  expect(json.headers()['content-type']).toContain('application/json');
  const normalize = (csp: string | undefined) => (csp ?? '').replace(/'nonce-[^']+'/g, "'nonce-*'");
  expect(normalize(response.headers()['content-security-policy'])).toBe(
    normalize(json.headers()['content-security-policy']),
  );
  expect(normalize(response.headers()['content-security-policy'])).toContain(
    "script-src 'self' 'nonce-*'",
  );
});

test('AC-244: OpenRouter OAuth 플래그 off(기본) → 설정 카드 없음, 연결 라우트 404', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await expect(page.getByRole('article', { name: 'Anthropic (Claude) 연결' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'OpenRouter 연결' })).toHaveCount(0);
  expect(
    (await page.request.get('/api/settings/oauth/openrouter/start', { maxRedirects: 0 })).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get('/api/settings/oauth/openrouter/callback?state=x&code=y', {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(404);
});

test('원가 질문은 키가 있어도 LLM 없이 기존 거부 문구 (AC-225)', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  await page.getByRole('button', { name: '새 대화' }).click();
  const reply = await ask(page, '이거 원가 얼마야?');
  await expect(reply).toContainText('원가 정보는 관리자만 조회할 수 있습니다');
});

test('GET /api/chat/status: 키·힌트 없이 상태만', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/');
  const response = await page.request.get('/api/chat/status');
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = (await response.json()) as { data: { llm: { status: string } } };
  expect(body.data.llm.status).toBe('ready');
  expect(JSON.stringify(body)).not.toMatch(/fake-valid-|fake-…/);
});
