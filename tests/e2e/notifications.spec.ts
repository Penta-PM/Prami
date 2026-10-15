import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs, signOutLocally } from './helpers';

/**
 * #31 PR-2 앱 내 알림 (스펙 §6 UI 수용 기준): ADMIN 공지 게시 → USER 배지 1·"알림 1개 안 읽음" → 항목 클릭으로 /notices/{id} 이동·배지 제거,
 * 모두 읽음 새로고침 유지, 게시자(ADMIN) 본인에게는 알림 없음, 챗 패널과 동시 표시 없음, 375/320px 가로 스크롤 0·1280px 종 기준 오른쪽 정렬.
 * 다른 스펙이 만든 공지 알림이 남아 있을 수 있어 시작 전에 두 픽스처 사용자의 알림을 모두 읽음으로 맞춘다(DB).
 * 정리: 이 스펙이 만든 공지(제목 접두사)를 소프트 삭제하고 그 알림 행을 지운다.
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = `E2E 알림 ${Date.now()}`;
const FIRST = `${PREFIX} 1`;
const SECOND = `${PREFIX} 2`;

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** 픽스처 사용자의 기존 알림을 모두 읽음으로 (다른 스펙이 만든 공지 알림 제거 효과) */
async function markFixturesRead() {
  await withDb((client) =>
    client.query(
      `update notifications set read_at = now()
        where read_at is null and user_id in (select id from users where email = any($1))`,
      [[FIXTURE_ADMIN, FIXTURE_USER]],
    ),
  );
}

async function cleanup() {
  await withDb(async (client) => {
    const like = `${PREFIX}%`;
    await client.query(
      `delete from notifications where ref_type = 'notice'
          and ref_id in (select id::text from notices where title like $1)`,
      [like],
    );
    await client.query(
      `update notices set deleted_at = now() where title like $1 and deleted_at is null`,
      [like],
    );
  });
}

test.afterAll(cleanup);

const bell = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const dropdown = (page: Page) => page.getByRole('dialog', { name: '알림' });

/** 이동·새로고침 뒤 첫 GET /api/notifications 응답을 기다린다 — 배지는 SSR 하지 않으므로 그 전의 "알림" 은 의미가 없다 */
async function gotoAndWaitForNotifications(page: Page, path: string) {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/notifications' && r.request().method() === 'GET',
  );
  await page.goto(path);
  expect((await response).status()).toBe(200);
}

async function openDropdown(page: Page, name: string) {
  await bell(page, name).click();
  const panel = dropdown(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('불러오는 중…')).toHaveCount(0);
  return panel;
}

async function createNotice(page: Page, title: string) {
  await page.goto('/admin/notices');
  await page.getByRole('button', { name: '+ 공지 등록' }).click();
  const dialog = page.getByRole('dialog', { name: '공지 등록' });
  await dialog.getByLabel('제목').fill(title);
  await dialog.getByLabel('내용').fill('E2E 알림 본문');
  await dialog.getByLabel('중요 공지로 표시').check();
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('status')).toContainText(`등록했습니다: ${title}`);
}

test('준비: 두 픽스처 사용자를 만들고 기존 알림을 읽음으로 맞춘다', async ({ page }) => {
  // 알림 수신 대상은 게시 시점의 활성 사용자다 — USER 가 아직 없을 수 있으니 한 번 로그인해 둔다
  await loginAs(page, FIXTURE_USER, '/');
  await signOutLocally(page);
  await loginAs(page, FIXTURE_ADMIN, '/');
  await markFixturesRead();
  await gotoAndWaitForNotifications(page, '/');
  await expect(bell(page, '알림')).toBeVisible();
});

test('ADMIN 게시 → 본인(게시자)에게는 알림이 생기지 않는다', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/');
  await createNotice(page, FIRST);
  await gotoAndWaitForNotifications(page, '/');
  await expect(bell(page, '알림')).toBeVisible();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  const panel = await openDropdown(page, '알림');
  await expect(panel).not.toContainText(FIRST);
});

test('USER: 배지 1·"알림 1개 안 읽음" → 항목 클릭 → /notices/{id} 이동, 배지 제거(새로고침 유지)', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/');
  await gotoAndWaitForNotifications(page, '/');
  const unread = bell(page, '알림 1개 안 읽음');
  await expect(unread).toBeVisible();
  await expect(unread).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(page.getByTestId('notification-badge')).toHaveText('1');

  const panel = await openDropdown(page, '알림 1개 안 읽음');
  await expect(bell(page, '알림 1개 안 읽음')).toHaveAttribute('aria-expanded', 'true');
  const item = panel.getByRole('link', { name: new RegExp(`새 공지: ${FIRST}`) });
  await expect(item).toBeVisible();
  await expect(item).toContainText('중요');
  await expect(item).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  await expect(item).toHaveAttribute('href', /^\/notices\/[0-9a-f-]{36}$/);
  const href = await item.getAttribute('href');

  // §6 axe 색 대비: 미읽음(보라 틴트) + 중요 배지가 든 열린 드롭다운 (#52 QA CRITICAL 1)
  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"][aria-label="알림"]')
    .withRules(['color-contrast'])
    .analyze();
  expect(
    axe.violations,
    JSON.stringify(axe.violations.map((v) => v.nodes.map((n) => n.html))),
  ).toEqual([]);
  expect(axe.passes.flatMap((rule) => rule.nodes).length, 'axe 가 검사한 요소').toBeGreaterThan(0);

  await item.click();
  await expect(page).toHaveURL((url) => url.pathname === href);
  await expect(page.getByRole('heading', { level: 1, name: FIRST })).toBeVisible();
  await expect(dropdown(page)).toHaveCount(0);
  await expect(bell(page, '알림')).toBeVisible();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);

  await gotoAndWaitForNotifications(page, '/');
  await expect(bell(page, '알림')).toBeVisible();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
});

test('모두 읽음 → 배지 0·버튼 비활성, 새로고침해도 유지', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/');
  await createNotice(page, SECOND);
  await signOutLocally(page);

  await loginAs(page, FIXTURE_USER, '/');
  await gotoAndWaitForNotifications(page, '/');
  const panel = await openDropdown(page, '알림 1개 안 읽음');
  const markAll = panel.getByRole('button', { name: '모두 읽음' });
  await expect(markAll).toBeEnabled();
  await markAll.click();
  await expect(bell(page, '알림')).toBeVisible();
  await expect(markAll).toBeDisabled();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);

  await gotoAndWaitForNotifications(page, '/');
  await expect(bell(page, '알림')).toBeVisible();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  const reopened = await openDropdown(page, '알림');
  await expect(reopened.getByRole('button', { name: '모두 읽음' })).toBeDisabled();
  await expect(reopened).toContainText(SECOND);
});

test('Escape 로 닫으면 포커스가 종 버튼으로 돌아온다', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/');
  await gotoAndWaitForNotifications(page, '/');
  await bell(page, '알림').focus();
  await page.keyboard.press('Enter');
  await expect(dropdown(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dropdown(page)).toHaveCount(0);
  await expect(bell(page, '알림')).toBeFocused();
});

test('챗 패널과 알림 드롭다운은 동시에 보이지 않는다', async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/');
  await gotoAndWaitForNotifications(page, '/');
  const chat = page.getByRole('complementary', { name: '가격정책 챗봇' });
  const launcher = page.getByRole('button', { name: '챗봇', exact: true });

  // 두 요소가 DOM 에 함께 있는 순간(퇴장 애니메이션 중 포함)을 페이지 안에서 기록한다 — DOM 변경마다 + 매 프레임.
  // 양방향(#31 Q1 A): 종 → 챗 퇴장 뒤 드롭다운, 챗 → 드롭다운 퇴장 뒤 패널. 상태 속성이 동시에 true 인 순간도 함께 센다.
  // (E2E 서버는 Motion 을 끈다 — 실제 퇴장 대기는 단위 테스트 bell.test '퇴장 애니메이션 대기' 가 확인한다)
  await page.evaluate(() => {
    const w = window as unknown as { __bothOpen: number; __bothShown: number };
    w.__bothOpen = 0;
    w.__bothShown = 0;
    const sample = () => {
      const chatOpen = document.querySelector('button[aria-label="챗봇"][aria-pressed="true"]');
      const bellOpen = document.querySelector(
        'button[aria-haspopup="dialog"][aria-expanded="true"]',
      );
      if (chatOpen && bellOpen) w.__bothOpen += 1;
      const panel = document.querySelector('aside[aria-label="가격정책 챗봇"]');
      const list = document.querySelector('[role="dialog"][aria-label="알림"]');
      if (panel && list) w.__bothShown += 1;
    };
    new MutationObserver(sample).observe(document.body, {
      attributes: true,
      subtree: true,
      childList: true,
    });
    const frame = () => {
      sample();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  await launcher.click();
  await expect(chat).toBeVisible();
  // 열린 챗 패널(오른쪽 고정·전체 높이)이 헤더 오른쪽의 종·챗 버튼을 덮으므로 이 방향은 키보드로 연다(포인터로는 닿지 않음)
  await bell(page, '알림').focus();
  await page.keyboard.press('Enter');
  await expect(dropdown(page)).toBeVisible();
  await expect(chat).toHaveCount(0);
  await expect(launcher).toHaveAttribute('aria-pressed', 'false');

  await launcher.click();
  await expect(chat).toBeVisible();
  await expect(dropdown(page)).toHaveCount(0);
  await expect(bell(page, '알림')).toHaveAttribute('aria-expanded', 'false');

  // 챗 패널을 닫아도 알림이 되살아나지 않는다 (챗 버튼도 패널 아래라 키보드로)
  await launcher.focus();
  await page.keyboard.press('Enter');
  await expect(chat).toHaveCount(0);
  await expect(dropdown(page)).toHaveCount(0);

  const counts = await page.evaluate(() => {
    const w = window as unknown as { __bothOpen: number; __bothShown: number };
    return { bothOpen: w.__bothOpen, bothShown: w.__bothShown };
  });
  expect(counts).toEqual({ bothOpen: 0, bothShown: 0 });
});

for (const width of [375, 320]) {
  test(`${width}px: 드롭다운은 헤더 아래 전체 폭(좌우 16px), 가로 스크롤 0`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await loginAs(page, FIXTURE_USER, '/');
    await gotoAndWaitForNotifications(page, '/');
    const panel = await openDropdown(page, '알림');
    const box = (await panel.boundingBox())!;
    expect(Math.round(box.x)).toBe(16);
    expect(Math.round(box.x + box.width)).toBe(width - 16);
    expect(box.y).toBeGreaterThanOrEqual(72 - 1);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  });
}

test('1280px: 폭 360px, 종 버튼 기준 오른쪽 정렬', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, FIXTURE_USER, '/');
  await gotoAndWaitForNotifications(page, '/');
  const button = bell(page, '알림');
  const panel = await openDropdown(page, '알림');
  const bellBox = (await button.boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.width)).toBe(360);
  expect(Math.round(box.x + box.width)).toBe(Math.round(bellBox.x + bellBox.width));
  expect(box.y).toBeGreaterThan(bellBox.y + bellBox.height);
});

/** #31 PR-3: 이 페이지에서 '중요' 배지가 걸린 axe color-contrast 위반 노드 (다른 요소의 기존 위반은 이 검사 대상 아님) */
async function importantBadgeContrastViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const checked = results.passes
    .flatMap((rule) => rule.nodes)
    .filter((node) => node.html.includes('>중요<'));
  const violations = results.violations
    .flatMap((rule) => rule.nodes)
    .filter((node) => node.html.includes('>중요<'))
    .map((node) => node.html);
  return { checked: checked.length, violations };
}

test('#31 PR-3: 공용 중요 배지 axe 대비 — /notices 목록·상세, 공지 관리', async ({ page }) => {
  await loginAs(page, FIXTURE_ADMIN, '/notices');
  for (const path of ['/notices', '/admin/notices']) {
    await page.goto(path);
    await expect(page.getByText(FIRST).first()).toBeVisible();
    const result = await importantBadgeContrastViolations(page);
    expect(result.violations, path).toEqual([]);
    expect(result.checked, `${path} 에서 검사한 중요 배지`).toBeGreaterThan(0);
  }
  await page.goto('/notices');
  await page.getByRole('link', { name: FIRST }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: FIRST })).toBeVisible();
  const detail = await importantBadgeContrastViolations(page);
  expect(detail.violations, '상세').toEqual([]);
  expect(detail.checked, '상세에서 검사한 중요 배지').toBeGreaterThan(0);
});

test('#31 PR-3: 알림 폴링 응답은 세션 쿠키를 재발급하지 않고, 다른 요청은 슬라이딩 연장 그대로', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/');
  const sessionCookies = (headers: { name: string; value: string }[]) =>
    headers
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .filter((header) => /(?:^|\s)(?:__Secure-)?authjs\.session-token/.test(header.value));

  const poll = await page.request.get('/api/notifications?limit=20');
  expect(poll.status()).toBe(200);
  expect(sessionCookies(poll.headersArray()), '알림 폴링 응답의 세션 Set-Cookie').toEqual([]);

  const status = await page.request.get('/api/chat/status');
  expect(status.status()).toBe(200);
  expect(
    sessionCookies(status.headersArray()).length,
    '챗봇 상태 조회는 기존처럼 세션 연장',
  ).toBeGreaterThan(0);
});
