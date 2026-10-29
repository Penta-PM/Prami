import { randomBytes } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, loginAs } from './helpers';

/**
 * 챗봇 답변 마크다운 렌더 (docs/specs/chat-markdown.md §3) — 가격 정책·조달 두 챗봇, fake 모델(LLM_VENDOR_MODE=fake)이
 * 질문에 "마크다운"이 있으면 제목·굵게·목록·GFM 표·인라인/블록 코드·인용이 든 합성 요약을 낸다(fake-chat.ts).
 * 픽스처 관리자 사용(분당 chat 버킷을 픽스처 사용자 스펙들과 나누지 않게). 합성 입찰 공고 bid_no 접두 `E2E-MD-`.
 */
const BID_PREFIX = 'E2E-MD-';
const BID_TITLE = 'E2E-MD 가상 기관 웹방화벽 구축';
const DAY = 86_400_000;

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await withDb(async (client) => {
    await client.query(`delete from procurement.bid_notices where bid_no like $1`, [
      `${BID_PREFIX}%`,
    ]);
    for (const table of ['chat_conversations', 'user_llm_credentials']) {
      await client.query(
        `delete from ${table} where user_id in (select id from users where email = $1)`,
        [FIXTURE_ADMIN],
      );
    }
  });
}

async function seedBid() {
  await withDb(async (client) => {
    const now = Date.now();
    await client.query(
      `insert into procurement.bid_notices (
         bid_no, title, products, demand_org, posted_at, deadline_at, budget, detail_url, fit_grade, fit_score, fit_reasons)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        `${BID_PREFIX}001`,
        BID_TITLE,
        ['WAPPLES'],
        'E2E 가상 수요기관',
        new Date(now - DAY),
        new Date(now + 5 * DAY),
        300_000_000,
        `https://example.invalid/bids/${BID_PREFIX}001`,
        '상',
        90,
        [],
      ],
    );
  });
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(cleanup);
test.afterAll(cleanup);

const chatLog = (page: Page) => page.getByRole('log', { name: '대화' });
const botBubbles = (page: Page) => chatLog(page).locator('[data-from="bot"]');

async function ask(page: Page, text: string): Promise<Locator> {
  const before = await botBubbles(page).count();
  await page.getByLabel('질문 입력').fill(text);
  await page.getByRole('button', { name: '보내기' }).click();
  const bubble = botBubbles(page).nth(before);
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toContainText('답변을 쓰는 중…', { timeout: 60_000 });
  return bubble;
}

/** 답변 말풍선 안의 마크다운 요소들 */
async function expectMarkdownElements(bubble: Locator, heading: RegExp, cell: string) {
  await expect(bubble.getByRole('heading', { level: 4, name: heading })).toBeVisible();
  await expect(bubble.locator('strong').first()).toBeVisible();
  await expect(bubble.locator('ul > li').first()).toBeVisible();
  await expect(bubble.locator('li code').first()).toBeVisible();
  const region = bubble.getByRole('region', { name: '표' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('columnheader').first()).toHaveAttribute('scope', 'col');
  await expect(region.getByRole('cell', { name: cell, exact: false }).first()).toBeVisible();
  await expect(bubble.locator('blockquote')).toContainText('합성 마크다운 응답입니다.');
  await expect(bubble.locator('pre code')).toHaveText('fake-markdown-block');
  // 원문 마크다운 기호가 글자로 남지 않는다
  await expect(bubble).not.toContainText('**');
  await expect(bubble).not.toContainText('###');
  await expect(bubble).not.toContainText('|---');
}

async function registerFakeKey(page: Page) {
  await page.goto('/settings');
  const card = page.getByRole('article', { name: 'Anthropic (Claude) 연결' });
  await card.getByRole('button', { name: '등록' }).click();
  await card.getByLabel(/API 키/).fill(`fake-valid-${randomBytes(12).toString('hex')}`);
  await card.getByRole('button', { name: '저장하고 검증' }).click();
  await expect(page.getByTestId('status-anthropic')).toHaveText('정상');
}

let pricingChatUrl = '';

test('가격 정책 챗봇: 답변 마크다운 요소 렌더, 새로고침 후 재열람도 같은 요소, 사용자 말풍선은 평문', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await loginAs(page, FIXTURE_ADMIN, '/settings');
  await registerFakeKey(page);
  await page.goto('/pricing/chat');
  await page.getByRole('button', { name: '새 대화' }).click();

  const answer = await ask(page, 'Wapples-500 (H500 T2) 가격 마크다운으로 알려줘');
  await expectMarkdownElements(answer, /\[fake LLM\] 조회 결과 \d+건/, 'Wapples-500');
  await expect(page).toHaveURL(/\/pricing\/chat\?c=/);
  pricingChatUrl = page.url();

  // 사용자 말풍선: 마크다운 기호를 보내도 평문 그대로
  const userText = '**굵게** | a | `코드` [링크](/pricing)';
  await page.getByLabel('질문 입력').fill(userText);
  await page.getByRole('button', { name: '보내기' }).click();
  const userBubble = chatLog(page).locator('[data-from="user"]').last();
  await expect(userBubble).toHaveText(userText);
  await expect(userBubble.locator('strong, code, a, table')).toHaveCount(0);
  await expect(botBubbles(page).last()).not.toContainText('답변을 쓰는 중…', { timeout: 60_000 });

  // 저장 대화 재열람
  await page.reload();
  await expectMarkdownElements(
    botBubbles(page).first(),
    /\[fake LLM\] 조회 결과 \d+건/,
    'Wapples-500',
  );
  await expect(chatLog(page).locator('[data-from="user"]').last()).toHaveText(userText);
});

test('표: 좁은 화면(375px)에서 표만 가로 스크롤, 말풍선·페이지 폭은 그대로, 키보드로 표 영역 포커스', async ({
  page,
}) => {
  test.skip(!pricingChatUrl, '앞 테스트의 대화가 필요합니다');
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAs(page, FIXTURE_ADMIN, '/pricing/chat');
  await page.goto(pricingChatUrl);
  const bubble = botBubbles(page).first();
  const region = bubble.getByRole('region', { name: '표' });
  await expect(region).toBeVisible();

  const sizes = await region.evaluate((el) => {
    const bubbleEl = el.closest('[data-from="bot"]') as HTMLElement;
    const log = el.closest('[role="log"]') as HTMLElement;
    return {
      regionScroll: el.scrollWidth,
      regionClient: el.clientWidth,
      bubble: bubbleEl.getBoundingClientRect().width,
      log: log.clientWidth,
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  expect(sizes.regionScroll).toBeGreaterThan(sizes.regionClient); // 표는 넘친다 → 래퍼가 가로 스크롤
  expect(sizes.bubble).toBeLessThanOrEqual(sizes.log * 0.9 + 1); // 말풍선 폭 상한(모바일 90%) 그대로
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport); // 페이지 가로 스크롤 0

  // 키보드: 말풍선 앞 요소에서 Tab 으로 표 영역에 닿는다 (tabIndex=0 region + 포커스 고리)
  await bubble.locator('h4').first().click();
  for (let i = 0; i < 10; i += 1) {
    if (await region.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(region).toBeFocused();
  await expect(region).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test('조달 챗봇: 답변 마크다운(입찰 공고 표) 렌더, 새로고침 후 재열람도 같은 요소', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await seedBid();
  await loginAs(page, FIXTURE_ADMIN, '/procurement/chat');
  await page.getByRole('button', { name: '새 대화' }).click();
  const answer = await ask(page, 'E2E-MD 입찰 공고 마크다운으로 찾아줘');
  await expectMarkdownElements(answer, /\[fake LLM\] 입찰 공고 1건/, BID_TITLE);
  await page.reload();
  await expectMarkdownElements(botBubbles(page).last(), /\[fake LLM\] 입찰 공고 1건/, BID_TITLE);
});
