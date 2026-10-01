import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_USER, loginAs } from './helpers';

/**
 * PRAMI-003 PR-1c (QA-1c ⑦⑨): /settings#llm 회사 API 키 주의 문구 — 0개·1개 상태, 폼 힌트(접근성 설명), 렌더된 색 대비 ≥ 4.5:1,
 * 320px 가로 스크롤 0, xAI 카드 포함 4장 레이아웃. LLM_VENDOR_MODE=fake — 실벤더 호출 없음.
 * 대비(AC-360 ① r3): axe 의존성 없이 렌더된 계산 색으로 WCAG 2.x 상대 휘도 공식을 직접 계산한다(PR #22 L-2 — Dev 구현 방식
 * 수용). axe-core 교차 확인은 QA 가 임시 주입으로 하고, 저장소 axe 도입은 PR-4(AC-375)다.
 * 스크린샷은 SCREENSHOT_DIR(기본 test-results/prami-003-1c)에 라이트·다크(prefers-color-scheme) 두 장씩 남긴다.
 */
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join('test-results', 'prami-003-1c');
const TITLE = '회사 API 키를 사용하세요';
const BODY =
  '개인 API 키를 사용하면 입력한 질문과 조회된 판매단가 등 민감한 업무 데이터가 벤더의 모델 학습에 활용될 수 있습니다. 업무에는 반드시 회사에서 발급한 API 키를 사용하세요.';
const HINT =
  '회사에서 발급한 API 키만 입력하세요. 개인 키는 입력한 데이터가 모델 학습에 활용될 수 있습니다.';
const XAI = 'xAI (Grok)';
const XAI_KEY = `fake-valid-${randomBytes(12).toString('hex')}`;

test.describe.configure({ mode: 'serial' });

async function resetFixtureUser() {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  try {
    const users = `select id from users where email = $1`;
    await client.query(`delete from user_llm_credentials where user_id in (${users})`, [
      FIXTURE_USER,
    ]);
    await client.query(`delete from user_settings where user_id in (${users})`, [FIXTURE_USER]);
  } finally {
    await client.end();
  }
}

test.beforeAll(resetFixtureUser);
test.afterAll(resetFixtureUser);

const warning = (page: Page) =>
  page.getByRole('region', { name: 'LLM 연결' }).getByRole('note', { name: TITLE });

/** AC-360 ①: WCAG 2.x 상대 휘도 대비(axe 아님) — 브라우저가 계산한 색(rgb()/color(srgb …))으로 */
/** 배경 = 글자 요소부터 위로 올라가며 처음 만나는 불투명 배경 (투명 배경을 검정으로 잘못 읽지 않게) */
async function contrastOf(text: Locator): Promise<number> {
  const { fg, bg } = await text.evaluate((node) => {
    const alpha = (value: string) => {
      const match = /\/\s*([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/.exec(value);
      return match ? Number(match[1] ?? match[2]) : value === 'transparent' ? 0 : 1;
    };
    let current: Element | null = node;
    while (current && alpha(getComputedStyle(current).backgroundColor) < 1) {
      current = current.parentElement;
    }
    return {
      fg: getComputedStyle(node).color,
      bg: current ? getComputedStyle(current).backgroundColor : 'rgb(255, 255, 255)',
    };
  });
  return contrast(parseColor(fg), parseColor(bg));
}

function parseColor(value: string): [number, number, number] {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(value);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  const rgb = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`색을 해석할 수 없습니다: ${value}`);
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

async function expectWarning(page: Page) {
  const note = warning(page);
  await expect(note).toBeVisible();
  await expect(note).toContainText(TITLE);
  await expect(note).toContainText(BODY);
  // h2 바로 다음 형제 (KEK 경고·미등록 안내·flash 보다 위)
  expect(
    await note.evaluate((node) => node.previousElementSibling?.matches('h2#llm-title') ?? false),
  ).toBe(true);
  await expect(note).not.toHaveAttribute('aria-live', /.*/);
  await expect(note.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  for (const part of [note.locator('strong'), note.getByText(BODY)]) {
    expect(await contrastOf(part)).toBeGreaterThanOrEqual(4.5);
  }
}

async function shoot(page: Page, name: string, target?: Locator) {
  const section = target ?? page.getByRole('region', { name: 'LLM 연결' });
  await section.scrollIntoViewIfNeeded();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await section.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('자격 증명 0개: 상단 role=note 주의 문구·WCAG 상대 휘도 대비 ≥ 4.5(AC-360 ①), 미등록 문구에 xAI, 카드 4장', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await page.goto('/settings#llm');
  await expectWarning(page);
  await expect(
    page.getByText('Anthropic·OpenAI·Google·xAI 중 하나의 키를 등록하면', { exact: false }),
  ).toBeVisible();
  const cards = page.getByRole('region', { name: 'LLM 연결' }).getByRole('article');
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole('article', { name: `${XAI} 연결` })).toBeVisible();
  // lg:grid-cols-3 에 4장 → 2행 (4번째 카드가 첫 카드 아래 줄에서 시작)
  const [first, fourth] = await Promise.all([
    cards.nth(0).boundingBox(),
    cards.nth(3).boundingBox(),
  ]);
  expect(fourth!.y).toBeGreaterThan(first!.y + first!.height - 1);
  expect(Math.abs(fourth!.x - first!.x)).toBeLessThan(2);
  await shoot(page, 'settings-llm-0-credentials');
});

test('xAI 등록 폼: 힌트가 입력란의 접근성 설명, 등록 후(1개) 주의 문구 유지·기본값 xAI grok-4.3 저장', async ({
  page,
}) => {
  await loginAs(page, FIXTURE_USER, '/settings');
  await page.goto('/settings#llm');
  const xaiCard = page.getByRole('article', { name: `${XAI} 연결` });
  await xaiCard.getByRole('button', { name: '등록' }).click();
  const input = xaiCard.getByLabel('xAI (Grok) API 키 등록');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await expect(input).toHaveAccessibleDescription(HINT);
  const hint = xaiCard.locator('#llm-key-hint-xai');
  await expect(hint).toHaveText(HINT);
  // AC-360 ①: 폼 힌트도 같은 상대 휘도 공식(axe 미사용, r3)
  expect(await contrastOf(hint)).toBeGreaterThanOrEqual(4.5);
  await shoot(page, 'settings-llm-xai-form', xaiCard);

  await input.fill(XAI_KEY);
  await xaiCard.getByRole('button', { name: '저장하고 검증' }).click();
  await expect(page.getByTestId('status-xai')).toHaveText('정상');
  await expect(page.getByTestId('hint-xai')).toHaveText(`fake-…${XAI_KEY.slice(-4)}`);
  await expectWarning(page);
  await expect(page.getByText(/아직 등록한 LLM API 키가 없습니다/)).toHaveCount(0);

  const defaults = page.getByRole('region', { name: '챗봇 기본값' });
  await defaults.getByLabel('기본 벤더').selectOption('xai');
  await defaults.getByLabel('모델').selectOption('grok-4.3');
  await defaults.getByRole('button', { name: '기본값 저장' }).click();
  await expect(page.getByRole('status')).toHaveText('챗봇 기본값을 저장했습니다');
  await page.reload();
  await expect(page.getByRole('region', { name: '챗봇 기본값' }).getByLabel('모델')).toHaveValue(
    'grok-4.3',
  );
  await shoot(page, 'settings-llm-1-credential');
});

/**
 * 320px: 앱 셸은 반응형이 아니다(사이드바 250px 고정 — 기존 레이아웃, 이 PR 범위 밖). 그래서 ① 뷰포트 320px 에서 문서 가로
 * 스크롤 0 ② 본문 열이 320px 일 때(뷰포트 = 사이드바 + 320) 주의 블록이 줄바꿈되어 자기 폭을 넘지 않는지 둘로 본다.
 */
test('320px: 문서 가로 스크롤 0, 본문 열 320px 에서 주의 문구가 줄바꿈되고 넘치지 않는다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await loginAs(page, FIXTURE_USER, '/settings');
  await page.goto('/settings#llm');
  await expect(warning(page)).toBeAttached();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 250 + 320, height: 900 });
  const main = page.locator('main');
  expect((await main.boundingBox())!.width).toBeLessThanOrEqual(320);
  const note = warning(page);
  await note.scrollIntoViewIfNeeded();
  const fits = await note.evaluate((node) => node.scrollWidth <= node.clientWidth);
  expect(fits).toBe(true);
  // 본문이 여러 줄로 줄바꿈된다 (한 줄로 넘치지 않음)
  const bodyHeight = (await note.getByText(BODY).boundingBox())!.height;
  expect(bodyHeight).toBeGreaterThan(40);
  await shoot(page, 'settings-llm-content-320px');
});
