import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * PRAMI-002 PR-A (QA-A): /settings LLM 키 등록·교체·기본값·삭제 (LLM_VENDOR_MODE=fake — 실벤더 호출 없음).
 * AC-203·204 ②·205·206·208·209·212·213. 키는 매 실행 무작위 꼬리를 붙여 만든다.
 */
const tail = () => randomBytes(12).toString('hex');
const USER_KEY = `fake-valid-${tail()}`;
const REPLACED_KEY = `fake-invalid-${tail()}`;
const USER_HINT = `fake-…${USER_KEY.slice(-4)}`;

async function dumpCredentialRows(): Promise<string> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select row_to_json(c)::text as j from user_llm_credentials c
       union all select row_to_json(a)::text from audit_logs a where action like 'settings.%'`,
    );
    return rows.map((row: { j: string }) => row.j).join('\n');
  } finally {
    await client.end();
  }
}

function card(page: Page, label: string) {
  return page.getByRole('article', { name: `${label} 연결` });
}

async function registerKey(page: Page, label: string, key: string) {
  const vendorCard = card(page, label);
  await vendorCard.getByRole('button', { name: /^(등록|교체)$/ }).click();
  const input = vendorCard.getByLabel(new RegExp(`${label.replace(/[()]/g, '\\$&')} API 키`));
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await input.fill(key);
  await vendorCard.getByRole('button', { name: '저장하고 검증' }).click();
}

test.describe.configure({ mode: 'serial' });

test('비로그인으로 /settings 에 오면 로그인으로 보낸다', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings/);
});

test('USER: 헤더 → 설정, fake 키 등록 → 힌트·정상, 교체 → 키 무효, 기본값 저장, 삭제 → 미등록', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER);
  await page.getByRole('link', { name: '사용자 설정' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: '사용자 설정' })).toBeVisible();
  await expect(page.getByText('챗봇 LLM 연결은 곧 제공됩니다')).toBeVisible();

  const anthropic = 'Anthropic (Claude)';
  await registerKey(page, anthropic, USER_KEY);
  await expect(page.getByTestId('status-anthropic')).toHaveText('정상');
  await expect(page.getByTestId('hint-anthropic')).toHaveText(USER_HINT);
  await expect(card(page, anthropic).getByLabel(/API 키/)).toHaveCount(0);

  // AC-204 ②: 새로 받은 /settings HTML(RSC 포함)에 키 평문이 없다
  const html = await (await page.request.get('/settings')).text();
  expect(html).toContain(USER_HINT);
  expect(html).not.toContain(USER_KEY.slice(-12));

  // AC-208 (r2): 정상 벤더만, Anthropic 기본 선택 claude-opus-5-5, 레거시 선택 시 배지, 저장
  const defaults = page.getByRole('region', { name: '챗봇 기본값' });
  const modelSelect = defaults.getByLabel('모델');
  await expect(modelSelect).toHaveValue('claude-opus-5-5');
  await expect(defaults.getByTestId('legacy-badge')).toHaveCount(0);
  await modelSelect.selectOption('claude-opus-5');
  await expect(defaults.getByTestId('legacy-badge')).toHaveText('레거시');
  await defaults.getByRole('button', { name: '기본값 저장' }).click();
  await expect(page.getByRole('status')).toHaveText('챗봇 기본값을 저장했습니다');

  // 교체 → fake-invalid → 키 무효
  await registerKey(page, anthropic, REPLACED_KEY);
  await expect(page.getByTestId('status-anthropic')).toHaveText('키 무효');
  await expect(page.getByTestId('hint-anthropic')).toHaveText(`fake-…${REPLACED_KEY.slice(-4)}`);

  // AC-206: 삭제 모달 → 미등록 + 콘솔 폐기 권장 문구
  await card(page, anthropic).getByRole('button', { name: '삭제' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
  await expect(page.getByTestId('status-anthropic')).toHaveText('미등록');
  await expect(page.getByRole('status')).toContainText('벤더 콘솔에서도 키를 폐기');

  // AC-204 ①: DB 행·감사 로그 어디에도 평문이 없다
  const dump = await dumpCredentialRows();
  expect(dump).not.toContain(USER_KEY.slice(-12));
  expect(dump).not.toContain(REPLACED_KEY.slice(-12));
});

test('AC-207 ⑦·AC-208: 목록에 기본 모델만 있는 키 → 다른 모델은 "이 키로 사용 불가" 비활성', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await registerKey(page, 'OpenAI', `fake-partial-${tail()}`);
  await expect(page.getByTestId('status-openai')).toHaveText('정상');
  const defaults = page.getByRole('region', { name: '챗봇 기본값' });
  await defaults.getByLabel('기본 벤더').selectOption('openai');
  const modelSelect = defaults.getByLabel('모델');
  await expect(modelSelect).toHaveValue('gpt-6.1-sol');
  for (const id of ['gpt-6-luna', 'gpt-6-astra']) {
    const option = modelSelect.locator(`option[value="${id}"]`);
    await expect(option).toHaveAttribute('disabled', '');
    await expect(option).toContainText('이 키로 사용 불가');
  }
  await defaults.getByRole('button', { name: '기본값 저장' }).click();
  await expect(page.getByRole('status')).toHaveText('챗봇 기본값을 저장했습니다');
  await card(page, 'OpenAI').getByRole('button', { name: '삭제' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
  await expect(page.getByTestId('status-openai')).toHaveText('미등록');
});

test('ADMIN 도 다른 사용자의 키를 볼 수 없다 (본인 설정만)', async ({ page, browser }) => {
  // USER 가 다시 키를 등록해 둔다
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await loginAs(userPage, FIXTURE_USER, '/settings');
  await registerKey(userPage, 'OpenAI', USER_KEY);
  await expect(userPage.getByTestId('status-openai')).toHaveText('정상');
  await userContext.close();

  await loginAs(page, FIXTURE_ADMIN, '/settings');
  await expect(page.getByTestId('status-openai')).toHaveText('미등록');
  await expect(page.getByTestId('hint-openai')).toHaveCount(0);
  const html = await (await page.request.get('/settings')).text();
  expect(html).not.toContain(USER_HINT);
  // 관리자 사용자 목록에도 LLM 연결 정보가 없다 (AC-205 ⑤)
  await page.goto('/admin/users');
  await expect(page.getByText(USER_HINT)).toHaveCount(0);
  const usersTable = page.getByRole('table', { name: '사용자 목록' });
  await expect(usersTable).toBeVisible();
  await expect(usersTable.getByText(/LLM|fake-…/)).toHaveCount(0);
});
