import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs, signOutLocally } from './helpers';

/**
 * UX PR-C2 챗봇 화면 (스펙 §7 C2): 헤더 챗봇 진입점·도킹 패널 없음, 알림 드롭다운 단독 정상, 가격 정책 챗봇·조달 챗봇 화면의
 * 목록/새 대화/이름 바꾸기/삭제 확인 모달/스트리밍 중지/오류 다시 시도/빈 상태, 새로고침 후 대화 유지(`?c=`), 모바일 너비 한 화면씩.
 * LLM 은 쓰지 않는다 — 키가 없는 상태(규칙 답, JSON 경로)에서 돌고, 중지·오류는 `page.route` 로 /api/chat 응답을 붙잡거나 바꾼다
 * (chat-guard.spec 의 route 방식). 실벤더 호출 없음(LLM_VENDOR_MODE=fake). 질문·제목은 합성 문구.
 * 시작·끝에 픽스처 사용자의 저장 대화와 LLM 자격 증명을 지운다(다른 챗봇 스펙과 독립).
 */
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
    const users = `select id from users where email in ($1, $2)`;
    for (const table of ['chat_conversations', 'user_llm_credentials', 'user_settings']) {
      await client.query(`delete from ${table} where user_id in (${users})`, [
        FIXTURE_USER,
        FIXTURE_ADMIN,
      ]);
    }
  });
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(cleanup);
test.afterAll(cleanup);

const PRICE_QUESTION = 'Wapples-500 (H500 T2) 가격 알려줘';

const conversationList = (page: Page) => page.getByRole('navigation', { name: '대화 목록' });
const chatLog = (page: Page) => page.getByRole('log', { name: '대화' });
const botBubbles = (page: Page) => chatLog(page).locator('[data-from="bot"]');

/** 질문 1건 → 새 봇 말풍선 */
async function ask(page: Page, text: string) {
  const before = await botBubbles(page).count();
  await page.getByLabel('질문 입력').fill(text);
  await page.getByRole('button', { name: '보내기' }).click();
  const bubble = botBubbles(page).nth(before);
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toContainText('답변을 쓰는 중…');
  return bubble;
}

/** chat-llm.spec 와 같은 이유(AC-374): /api/chat 첫 컴파일을 화면 검사 전에 끝낸다 */
async function warmUp(page: Page) {
  const warm = await page.request.post('/api/chat', {
    data: { message: '워밍업' },
    timeout: 120_000,
  });
  expect(warm.status()).toBe(200);
}

const currentConversationId = (page: Page) => new URL(page.url()).searchParams.get('c');

test('셸: 헤더 챗봇 버튼·도킹 패널 없음, 사이드바 두 챗봇 메뉴, 알림 드롭다운은 단독으로 열고 닫힌다', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/');
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('button', { name: /챗봇/ })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: /챗봇/ })).toHaveCount(0);
  const nav = page.getByRole('complementary', { name: '주 메뉴' });
  await expect(nav.getByRole('link', { name: '가격 정책 챗봇' })).toHaveAttribute(
    'href',
    '/pricing/chat',
  );
  await expect(nav.getByRole('link', { name: '조달 챗봇' })).toHaveAttribute(
    'href',
    '/procurement/chat',
  );
  await nav.getByRole('link', { name: '가격 정책 챗봇' }).click();
  await expect(page).toHaveURL(/\/pricing\/chat$/);
  await expect(nav.getByRole('link', { name: '가격 정책 챗봇' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: '가격 정책 조회' })).not.toHaveAttribute(
    'aria-current',
  );
  // 알림: 챗봇 화면에서도 단독으로 열고 Esc 로 닫힌다 (#31 결합 제거)
  const bell = page.getByRole('button', { name: /^알림/ });
  await bell.click();
  await expect(page.getByRole('dialog', { name: '알림' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '알림' })).toHaveCount(0);
  await expect(bell).toBeFocused();
});

test('가격 정책 챗봇: 빈 상태 → 첫 질문으로 대화 생성(?c=)·자동 제목, 새로고침·계산기 갔다 오기 후에도 복원', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  await warmUp(page);
  await page.reload();
  await expect(conversationList(page)).toContainText('저장된 대화가 없습니다');
  await expect(chatLog(page)).toContainText('무엇이든 물어보세요');
  await expect(chatLog(page).getByRole('group', { name: '예시 질문' })).toBeVisible();

  const answer = await ask(page, PRICE_QUESTION);
  await expect(answer).toContainText('12,000,000원');
  await expect(page).toHaveURL(/\/pricing\/chat\?c=[0-9a-f-]{36}$/);
  const id = currentConversationId(page)!;
  // 자동 제목 = 첫 질문 앞 30자, 선택 행
  const row = conversationList(page).getByRole('link', {
    name: /Wapples-500 \(H500 T2\) 가격 알려줘/,
  });
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(row).toContainText('방금');
  // 말풍선마다 작성 시각
  await expect(chatLog(page).locator('time')).toHaveCount(2);

  // 새로고침 → DB 에서 복원
  await page.reload();
  await expect(botBubbles(page).first()).toContainText('12,000,000원');
  await expect(chatLog(page).locator('[data-from="user"]').first()).toHaveText(PRICE_QUESTION);

  // 견적 링크는 같은 탭 이동, 뒤로 가기로 돌아오면 같은 대화가 복원된다
  const quote = await ask(page, 'Wapples-500 (H500 T2) 견적 뽑아줘');
  const link = quote.getByRole('link', { name: /견적 계산기에서 이어서 선택/ });
  await expect(link).not.toHaveAttribute('target', '_blank');
  await link.click();
  await expect(page).toHaveURL(/\/calculator\?family=WAPPLES&item=P10100015$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`\\?c=${id}$`));
  await expect(botBubbles(page)).toHaveCount(2);
  await expect(botBubbles(page).last()).toContainText('견적');
});

test('새 대화·이름 바꾸기(Enter 저장·Esc 취소)·삭제 확인 모달', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  await expect(conversationList(page).getByRole('link')).toHaveCount(1);

  // 새 대화: ?c= 가 지워지고 빈 대화창, 첫 질문을 보내야 목록에 생긴다
  await page.getByRole('button', { name: '새 대화' }).click();
  await expect(page).toHaveURL(/\/pricing\/chat$/);
  await expect(page.getByLabel('질문 입력')).toBeFocused();
  await expect(conversationList(page).getByRole('link')).toHaveCount(1);
  await ask(page, '도움말 질문 합성');
  await expect(conversationList(page).getByRole('link')).toHaveCount(2);
  const row = conversationList(page).getByRole('link', { name: /도움말 질문 합성/ });
  await expect(row).toHaveAttribute('aria-current', 'page');

  // 이름 바꾸기 — Esc 취소
  await conversationList(page).getByRole('button', { name: '도움말 질문 합성 메뉴' }).click();
  await page.getByRole('menuitem', { name: '이름 바꾸기' }).click();
  const input = conversationList(page).getByRole('textbox', { name: '대화 이름' });
  await input.fill('취소될 이름');
  await input.press('Escape');
  await expect(row).toBeFocused();
  await expect(conversationList(page)).not.toContainText('취소될 이름');

  // 이름 바꾸기 — 키보드로 메뉴 열기 + Enter 저장
  await conversationList(page).getByRole('button', { name: '도움말 질문 합성 메뉴' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '이름 바꾸기' })).toBeFocused();
  await page.keyboard.press('Enter');
  await input.fill('합성 대화 이름');
  await input.press('Enter');
  const renamed = conversationList(page).getByRole('link', { name: /합성 대화 이름/ });
  await expect(renamed).toBeVisible();
  await expect(renamed).toBeFocused();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('합성 대화 이름');
  await page.reload();
  await expect(conversationList(page).getByRole('link', { name: /합성 대화 이름/ })).toBeVisible();

  // 삭제 — 취소 후 확인
  await conversationList(page).getByRole('button', { name: '합성 대화 이름 메뉴' }).click();
  await page.getByRole('menuitem', { name: '삭제' }).click();
  const dialog = page.getByRole('dialog', { name: '대화 삭제' });
  await expect(dialog).toContainText('되돌릴 수 없습니다');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toHaveCount(0);
  await conversationList(page).getByRole('button', { name: '합성 대화 이름 메뉴' }).click();
  await page.getByRole('menuitem', { name: '삭제' }).click();
  await dialog.getByRole('button', { name: '삭제' }).click();
  await expect(conversationList(page).getByRole('link', { name: /합성 대화 이름/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/pricing\/chat$/);
  await expect(conversationList(page).getByRole('link')).toHaveCount(1);
  await expect(conversationList(page).getByRole('link').first()).toBeFocused();
});

test('스트리밍 중지 → "답변을 중단했습니다" → 다시 시도, 오류 응답 → 다시 시도 (질문은 한 번만 저장)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  await page.getByRole('button', { name: '새 대화' }).click();

  // 응답을 붙잡아 두고 중지
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    // 서버로 보내지 않고 붙잡아 둔다 — 그 사이 클라이언트가 중지(abort)하면 이어 보내기는 실패하고 무시한다
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.abort().catch(() => undefined);
  });
  await page.getByLabel('질문 입력').fill(PRICE_QUESTION);
  await page.getByRole('button', { name: '보내기' }).click();
  const stop = page.getByRole('button', { name: '중지' });
  await expect(stop).toBeVisible();
  await expect(chatLog(page)).toHaveAttribute('aria-busy', 'true');
  await stop.click();
  await expect(botBubbles(page).last()).toHaveText('답변을 중단했습니다.');
  await page.unroute('**/api/chat');
  await chatLog(page).getByRole('button', { name: '다시 시도' }).click();
  await expect(botBubbles(page).last()).toContainText('12,000,000원');
  await expect(chatLog(page).locator('[data-from="user"]')).toHaveCount(1);

  // 오류 응답(봉투) 1회 → 다시 시도
  let failed = false;
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST' || failed) return route.continue();
    failed = true;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: '합성 서버 오류' } }),
    });
  });
  const errorBubble = await ask(page, '도움말 질문 합성 2');
  await expect(errorBubble).toHaveText('합성 서버 오류');
  await chatLog(page).getByRole('button', { name: '다시 시도' }).click();
  await expect(botBubbles(page).last()).not.toHaveText('합성 서버 오류');
  await expect(botBubbles(page).last()).toContainText('아직 학습 중인 질문이에요');

  // 새로고침 후: 질문 2개·답 2개 (중지·오류 시도는 질문을 다시 쌓지 않음)
  await page.unroute('**/api/chat');
  await page.reload();
  await expect(chatLog(page).locator('[data-from="user"]')).toHaveCount(2);
  await expect(botBubbles(page)).toHaveCount(2);
});

test('조달 챗봇: 목록·새 대화 동작, 전송은 서버의 "아직 준비 중" 안내를 오류 말풍선으로 (PR-C3 전)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/procurement/chat');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('조달 챗봇');
  await expect(conversationList(page)).toContainText('저장된 대화가 없습니다');
  const examples = chatLog(page).getByRole('group', { name: '예시 질문' });
  await examples.getByRole('button').first().click();
  await expect(botBubbles(page).last()).toHaveText('조달 챗봇은 아직 준비 중입니다');
  await expect(page).toHaveURL(/\/procurement\/chat\?c=/);
  // 가격 챗봇 목록에는 섞이지 않는다
  await page.goto('/pricing/chat');
  await expect(conversationList(page)).not.toContainText('조달');
});

test('모바일 375px: 목록 또는 대화 한 화면씩, "대화 목록"으로 돌아가기, 가로 스크롤 0', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  const list = conversationList(page);
  await expect(list.getByRole('link').first()).toBeVisible();
  await expect(page.getByLabel('질문 입력')).toBeHidden();
  await list.getByRole('link').first().click();
  await expect(page).toHaveURL(/\?c=/);
  await expect(list).toBeHidden();
  await expect(chatLog(page)).toBeVisible();
  await page.getByRole('button', { name: '대화 목록' }).click();
  await expect(list).toBeVisible();
  await expect(page.getByLabel('질문 입력')).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('소유자 전용: 다른 사용자의 대화 id 로 열면 "대화를 찾을 수 없습니다"', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/pricing/chat');
  const row = conversationList(page).getByRole('link').first();
  await row.click();
  const id = currentConversationId(page)!;
  await signOutLocally(page);
  await loginAs(page, FIXTURE_ADMIN, `/pricing/chat?c=${id}`);
  await expect(chatLog(page).getByRole('alert')).toContainText('대화를 찾을 수 없습니다');
  await expect(page.getByLabel('질문 입력')).toBeDisabled();
});
