import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_USER, loginAs } from './helpers';

/**
 * 조달이 통합 UI-3 (입찰 공고 `/procurement/bids`): 제품 칩(건수)·진행 중/마감 포함·적합도순/게시순·상만 → URL(replace),
 * 적합도 배지(글자 + 점수), 공고명 외부 링크(새 탭 + rel, 행 클릭은 새 창 없음), 근거 ＋/－ 펼침, D-day 배지(임박·마감),
 * 예산·추정가 억·만, 320px 가로 스크롤 없음(표 안에서만 스크롤), 조회 상태 기억.
 *
 * E2E DB 에는 조달 데이터가 없다 → 이 스펙이 **합성** 공고(가상 기관·example.invalid 링크)를 넣고 전후로 지운다.
 * 마감은 지금 기준 상대 시각. workers 1 · serial 이라 다른 스펙(procurement-shell 의 빈 상태)과 겹치지 않는다.
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = 'E2E-BID-';
const DAY = 86_400_000;

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function cleanUp(client: pg.Client) {
  await client.query(`delete from procurement.bid_notices where bid_no like $1`, [`${PREFIX}%`]);
}

type SyntheticBid = {
  no: string;
  title: string;
  products: string[];
  postedDays: number;
  deadlineDays: number | null;
  budget: number | null;
  estPrice: number | null;
  grade: string | null;
  score: number | null;
  reasons: string[];
};

const BIDS: SyntheticBid[] = [
  {
    no: `${PREFIX}001`,
    title: 'E2E 가상 기관 웹방화벽 고도화',
    products: ['WAPPLES'],
    postedDays: -2,
    deadlineDays: 10,
    budget: 1_234_000_000,
    estPrice: 1_100_000_000,
    grade: '상',
    score: 91,
    reasons: ['＋ 공고명에 제품 키워드', '＋ 예산 충분', '－ 용역 공고'],
  },
  {
    no: `${PREFIX}002`,
    title: 'E2E 가상 기관 DB 암호화 구축',
    products: ['D.AMO'],
    postedDays: -1,
    deadlineDays: 1.5,
    budget: 45_670_000,
    estPrice: null,
    grade: '중',
    score: 60,
    reasons: ['＋ 제품 키워드'],
  },
  {
    no: `${PREFIX}003`,
    title: 'E2E 가상 기관 통합인증 지난 공고',
    products: ['iSIGN'],
    postedDays: -30,
    deadlineDays: -5,
    budget: 300_000_000,
    estPrice: null,
    grade: '상',
    score: 80,
    reasons: [],
  },
];

test.beforeAll(async () => {
  await withDb(async (client) => {
    await cleanUp(client);
    const now = Date.now();
    for (const bid of BIDS) {
      await client.query(
        `insert into procurement.bid_notices (
           bid_no, title, products, demand_org, posted_at, deadline_at, budget, est_price, detail_url,
           fit_grade, fit_score, fit_reasons)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          bid.no,
          bid.title,
          bid.products,
          'E2E 가상 수요기관',
          new Date(now + bid.postedDays * DAY),
          bid.deadlineDays === null ? null : new Date(now + bid.deadlineDays * DAY),
          bid.budget,
          bid.estPrice,
          `https://example.invalid/bids/${bid.no}`,
          bid.grade,
          bid.score,
          bid.reasons,
        ],
      );
    }
  });
});

test.afterAll(async () => {
  await withDb(cleanUp);
});

const table = (page: Page) => page.getByRole('table', { name: '입찰 공고 목록' });
const bodyRows = (page: Page) => table(page).locator('tbody > tr');

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
}

test.beforeEach(async ({ page }) => {
  await loginAs(page, FIXTURE_USER, '/procurement/bids');
});

test('기본: 진행 중·적합도순 — 칩 건수, 적합도 배지, 억·만, D-day 임박', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: '입찰 공고' })).toBeVisible();
  await expect(page.getByTestId('procurement-bids-last-checked')).toBeVisible();
  const chips = page.getByRole('group', { name: '제품' });
  await expect(chips.getByRole('button', { name: '전체 2건' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chips.getByRole('button', { name: 'WAPPLES 1건' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'iSIGN 0건' })).toBeVisible();

  await expect(bodyRows(page)).toHaveCount(2);
  const first = bodyRows(page).nth(0);
  await expect(first).toContainText('E2E 가상 기관 웹방화벽 고도화');
  await expect(first).toContainText('상');
  await expect(first).toContainText('91점');
  await expect(first).toContainText('12억 3,400만');
  await expect(first).toContainText('11억');
  const second = bodyRows(page).nth(1);
  await expect(second.getByTestId('bid-deadline-badge')).toHaveText(/D-[12] 임박/);
  await expect(second.getByTestId('bid-deadline-badge')).toHaveCSS(
    'background-color',
    'rgb(245, 158, 11)', // --accent-orange = Penta Warning 500
  );
  await expect(second).toContainText('4,567만');
});

test('공고명은 새 탭 링크(rel noopener noreferrer), 행 클릭은 새 창을 열지 않는다', async ({
  page,
  context,
}) => {
  const link = bodyRows(page)
    .nth(0)
    .getByRole('link', { name: /E2E 가상 기관 웹방화벽 고도화/ });
  await expect(link).toHaveAttribute('href', `https://example.invalid/bids/${PREFIX}001`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link.locator('svg[data-icon="external-link"]')).toHaveCount(1);

  const pagesBefore = context.pages().length;
  const url = page.url();
  await bodyRows(page).nth(0).getByText('E2E 가상 수요기관').click();
  await page.waitForTimeout(300);
  expect(context.pages()).toHaveLength(pagesBefore);
  expect(page.url()).toBe(url);
});

test('근거 ＋/－ 를 표 안에서 펼치고 접는다', async ({ page }) => {
  const toggle = bodyRows(page)
    .nth(0)
    .getByRole('button', { name: /근거 보기/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const list = page.getByRole('list', { name: 'E2E 가상 기관 웹방화벽 고도화 적합도 근거' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list).toContainText('공고명에 제품 키워드');
  await expect(list).toContainText('용역 공고');
  await page.getByRole('button', { name: /근거 접기/ }).click();
  await expect(list).toHaveCount(0);
});

test('조건 → URL(replace): 마감 포함·제품 칩·게시순·상만', async ({ page }) => {
  await page.getByRole('radio', { name: '마감 포함' }).click();
  await expect(page).toHaveURL(/\/procurement\/bids\?closed=1$/);
  await expect(page.getByRole('button', { name: '전체 3건' })).toBeVisible();
  await page.getByRole('button', { name: 'iSIGN 1건' }).click();
  await expect(page).toHaveURL(/\/procurement\/bids\?product=iSIGN&closed=1$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).nth(0)).toHaveAttribute('data-closed', 'true');
  await expect(bodyRows(page).nth(0).getByTestId('bid-deadline-badge')).toHaveText('마감');

  await page.getByRole('button', { name: '전체 3건' }).click();
  await page.getByRole('radio', { name: '게시순' }).click();
  await expect(page).toHaveURL(/\/procurement\/bids\?closed=1&sort=posted$/);
  await expect(bodyRows(page).nth(0)).toContainText('E2E 가상 기관 DB 암호화 구축');

  await page.getByRole('button', { name: '상만' }).click();
  await expect(page).toHaveURL(/\/procurement\/bids\?closed=1&top=1&sort=posted$/);
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(table(page)).not.toContainText('DB 암호화 구축');
});

test('조회 상태 기억: 다시 들어오면 마지막 조건', async ({ page }) => {
  await page.getByRole('button', { name: 'WAPPLES 1건' }).click();
  await expect(page).toHaveURL(/\/procurement\/bids\?product=WAPPLES$/);
  await expect
    .poll(
      () =>
        withDb(async (client) => {
          const { rows } = await client.query<{ query: string }>(
            `select v.query from user_view_states v join users u on u.id = v.user_id
             where u.email = $1 and v.page_key = 'procurement-bids'`,
            [FIXTURE_USER],
          );
          return rows[0]?.query ?? null;
        }),
      { timeout: 10_000 },
    )
    .toBe('product=WAPPLES');
  await page.goto('/procurement/bids');
  await expect(page).toHaveURL(/\/procurement\/bids\?product=WAPPLES$/);
});

test('320px: 페이지 가로 스크롤 없음, 표는 표 안에서만 스크롤', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/procurement/bids?closed=1');
  await expect(bodyRows(page)).toHaveCount(3);
  await expectNoHorizontalScroll(page);
  const wrapper = await table(page).evaluate((element) => {
    const parent = element.parentElement!;
    return { scroll: parent.scrollWidth, client: parent.clientWidth };
  });
  expect(wrapper.scroll).toBeGreaterThan(wrapper.client);
});
