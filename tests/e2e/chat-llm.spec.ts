import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * PRAMI-002 PR-B (QA-B ①②, AC-222): 키 없는 USER → 패널 배너·첫 봇 메시지 안내·설정 링크, 질문은 규칙 답 + 안내.
 * 같은 화면에서 설정에 fake 키를 저장한 뒤 **새로고침 없이** 같은 질문 → LLM 경로(fake 모델). 실벤더 호출 없음(LLM_VENDOR_MODE=fake).
 * 다른 스펙(PR-10 chat.spec)이 규칙 경로로 돌도록 시작·끝에 픽스처 사용자의 LLM 자격 증명을 지운다.
 */
async function clearCredentials() {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    const users = `select id from users where email in ($1, $2)`;
    for (const table of ['user_llm_credentials', 'user_settings']) {
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
  const panel = page.getByRole('complementary', { name: '가격정책 챗봇' });
  const before = await panel.locator('[data-from="bot"]').count();
  await panel.getByLabel('질문 입력').fill(text);
  await panel.getByRole('button', { name: '보내기' }).click();
  const bubble = panel.locator('[data-from="bot"]').nth(before);
  await expect(bubble).toBeVisible();
  return bubble;
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(clearCredentials);
test.afterAll(clearCredentials);

test('키 없음 → 배너·안내·규칙 답, 설정에서 fake 키 저장 → 새로고침 없이 LLM 경로', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await page.getByRole('button', { name: '챗봇', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '가격정책 챗봇' });
  const banner = panel.getByRole('status', { name: 'LLM 연결 안내' });
  await expect(banner).toContainText('LLM API 키가 등록되지 않았습니다');
  await expect(banner.getByRole('link', { name: /사용자 설정에서 등록하기/ })).toHaveAttribute(
    'href',
    '/settings#llm',
  );
  const greeting = panel.locator('[data-from="bot"]').first();
  await expect(greeting).toContainText('무엇이든 물어보세요');
  await expect(greeting).toContainText('LLM API 키가 등록되지 않았습니다');

  // 규칙 답 (AC-80 ① 후보 병기) + 짧은 안내
  const rule = await ask(page, 'Wapples-500 가격');
  await expect(rule).toContainText('Wapples-500 (H500 T2) 12,000,000원');
  await expect(rule).toContainText('LLM 미연결 — 기본 응답');

  // 같은 화면(패널 열린 채)에서 키 등록 — 새로고침 없음
  const card = page.getByRole('article', { name: 'Anthropic (Claude) 연결' });
  await card.getByRole('button', { name: '등록' }).click();
  await card.getByLabel(/API 키/).fill(`fake-valid-${randomBytes(12).toString('hex')}`);
  await card.getByRole('button', { name: '저장하고 검증' }).click();
  await expect(page.getByTestId('status-anthropic')).toHaveText('정상');

  const llm = await ask(page, 'Wapples-500 가격');
  await expect(llm).toContainText('[fake LLM] 조회 결과');
  await expect(llm).not.toContainText('LLM 미연결');
  // 응답의 llm 상태로 배너가 사라지고 과금 고지가 보인다
  await expect(banner).toHaveCount(0);
  await expect(panel.getByRole('note', { name: '과금 안내' })).toContainText('본인 벤더 계정');
});

test('원가 질문은 키가 있어도 LLM 없이 기존 거부 문구 (AC-225)', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await page.getByRole('button', { name: '챗봇', exact: true }).click();
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
