import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Request } from '@playwright/test';
import pg from 'pg';

import { E2E_ENV } from '../../playwright.config';
import { FIXTURE_ADMIN, FIXTURE_USER, loginAs } from './helpers';

/**
 * 출력 가드 E2E (스펙 output-guard-coverage-2 §2 PR-1 ④·§4 PR-1): 설정 화면에서 미러 키(`fake-mirror-`)를 저장하면 챗봇이
 * 질문에서 표식 `§` 를 지운 텍스트를 3자 청크로 스트리밍한다. `원§가` 처럼 표식을 끼워 precheck(COST_RE)를 우회하고
 * **출력 가드**(SSE 토큰 가드 + compose 최종 가드)까지 도달시킨다. 행의 R/K 는 현재 가드 판정(mentionsCostAmount) 기준.
 * PR-2(§2 G1–G6) 대표 R행: 円(G1)·엔(G2)·배수 접미 + 통화(G3)·영어 수사 + 통화(G4)·'원' 없는 억(G5)·천만(G6) — 역할별로 3건씩.
 * - R행: 최종 말풍선 = 역할별 거부 문구(USER·ADMIN 각각), final.mode=llm(precheck 거부가 아님),
 *   금액 원문이 SSE 응답 본문·봇 말풍선 DOM·다음 요청의 대화 기록(assistant) 어디에도 0회.
 * - K행: 응답 = 입력(표식 제거 후).
 * - 미러 청크(3자) 경계에 금액이 걸치는 R행 1건 이상 (아래 straddlesChunk 로 확인).
 * 시작·끝에 픽스처 사용자의 LLM 자격 증명을 지운다(다른 챗봇 스펙은 키 없는 상태에서 시작).
 */
const MARK = '§';
const CHUNK = 3;
/** 역할별 거부 문구 (src/server/chat/respond.ts COST_REPLY·COST_REPLY_USER — E2E 는 서버 모듈을 import 하지 않는다) */
const COST_REPLY_ADMIN =
  '원가 정보는 챗봇에서 제공하지 않습니다. 대신 견적 계산기에서 예상 견적 금액을 확인해보세요.';
const COST_REPLY_USER =
  '원가 정보는 관리자만 조회할 수 있습니다. 대신 견적 계산기에서 예상 견적 금액을 확인해보세요.';

type Row = { input: string; verdict: 'R' | 'K'; amount?: string };

/** 일반 사용자 — 첫 R행 `1,000원` 은 청크 "원가는|␠1,|000|원입니|다." 에 걸친다. 둘째 행은 앞 문장 토큰이 나간 뒤 차단(discard) */
const USER_ROWS: Row[] = [
  { input: `원${MARK}가는 1,000원입니다.`, verdict: 'R', amount: '1,000원' },
  {
    input: `견적 문의 감사합니다. 원${MARK}가는 12,345원입니다.`,
    verdict: 'R',
    amount: '12,345원',
  },
  { input: `매${MARK}입가는 오천만 원입니다.`, verdict: 'R', amount: '오천만 원' },
  { input: `The co${MARK}st is $1,250.`, verdict: 'R', amount: '$1,250' },
  // PR-2 G1·G3·G5
  { input: `원${MARK}가는 500円입니다.`, verdict: 'R', amount: '500円' },
  { input: `The co${MARK}st is 5 million won.`, verdict: 'R', amount: '5 million won' },
  { input: `원${MARK}가는 3억입니다.`, verdict: 'R', amount: '3억' },
  { input: `원${MARK}가 기준은 2025년입니다.`, verdict: 'K' },
  { input: `원${MARK}가 항목은 3개입니다.`, verdict: 'K' },
];

const ADMIN_ROWS: Row[] = [
  { input: `원${MARK}가는 2,500달러입니다.`, verdict: 'R', amount: '2,500달러' },
  { input: `이${MARK}익률은 35%입니다.`, verdict: 'R', amount: '35%' },
  { input: `마${MARK}진은 KRW 50,000입니다.`, verdict: 'R', amount: 'KRW 50,000' },
  // PR-2 G2·G4·G6
  { input: `원${MARK}가는 오천 엔입니다.`, verdict: 'R', amount: '오천 엔' },
  {
    input: `The co${MARK}st is several million dollars.`,
    verdict: 'R',
    amount: 'several million dollars',
  },
  { input: `마${MARK}진은 5천만 정도입니다.`, verdict: 'R', amount: '5천만' },
  { input: `The co${MARK}st report has 12 pages.`, verdict: 'K' },
  { input: `마${MARK}진 검토 대상 품목은 40개입니다.`, verdict: 'K' },
];

const mirrored = (input: string) => input.split(MARK).join('');

/** 미러 출력(코드 포인트 3자 청크)에서 금액이 청크 경계를 가로지르는지 */
function straddlesChunk(row: Row): boolean {
  if (!row.amount) return false;
  const text = mirrored(row.input);
  const start = Array.from(text.slice(0, text.indexOf(row.amount))).length;
  const end = start + Array.from(row.amount).length;
  const firstBoundary = (Math.floor(start / CHUNK) + 1) * CHUNK;
  return text.includes(row.amount) && firstBoundary < end;
}

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

/** chat-llm.spec 와 같은 이유(AC-374): 파일 이름 순서상 이 스펙이 /api/chat 을 처음 부를 수 있어 라우트 컴파일을 먼저 끝낸다 */
async function warmUpChatRoute(page: Page) {
  const status = await page.request.get('/api/chat/status', { timeout: 120_000 });
  expect(status.status()).toBe(200);
  const warm = await page.request.post('/api/chat', {
    data: { message: '워밍업', history: [] },
    timeout: 120_000,
  });
  expect(warm.status()).toBe(200);
}

async function saveMirrorKey(page: Page) {
  const card = page.getByRole('article', { name: 'Anthropic (Claude) 연결' });
  await card.getByRole('button', { name: /^(등록|교체)$/ }).click();
  await card.getByLabel(/API 키/).fill(`fake-mirror-${randomBytes(12).toString('hex')}`);
  await card.getByRole('button', { name: '저장하고 검증' }).click();
  await expect(page.getByTestId('status-anthropic')).toHaveText('정상');
}

type SseEvent = { event: string; data: Record<string, unknown> };

function parseSse(raw: string): SseEvent[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => ({
      event: /^event: (.+)$/m.exec(block)?.[1] ?? '',
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as Record<string, unknown>,
    }));
}

const isChatPost = (request: Request) =>
  request.url().endsWith('/api/chat') && request.method() === 'POST';

/**
 * SSE 본문 수집. 스트리밍 응답은 response.text() 로 읽을 수 없어(CDP: No data found for resource) route 로 받아 기록한 뒤
 * 같은 응답을 그대로 넘긴다. 서버는 그대로 토큰 가드를 거쳐 스트리밍하고, 브라우저는 완료된 본문을 한 번에 받는다.
 */
async function captureChatBodies(page: Page): Promise<string[]> {
  const bodies: string[] = [];
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    bodies.push(body);
    await route.fulfill({ response, body });
  });
  return bodies;
}

/** 질문 1건: SSE 응답 본문(완료까지)과 봇 말풍선 */
async function ask(page: Page, bodies: string[], text: string) {
  const panel = page.getByRole('complementary', { name: '가격정책 챗봇' });
  const bots = panel.locator('[data-from="bot"]');
  const before = await bots.count();
  const seen = bodies.length;
  const responsePromise = page.waitForResponse((response) => isChatPost(response.request()));
  await panel.getByLabel('질문 입력').fill(text);
  await panel.getByRole('button', { name: '보내기' }).click();
  const response = await responsePromise;
  expect(response.headers()['content-type']).toContain('text/event-stream');
  await expect.poll(() => bodies.length).toBeGreaterThan(seen);
  const raw = bodies[seen]!;
  const events = parseSse(raw);
  const final = events.find((event) => event.event === 'final')?.data;
  const tokens = events
    .filter((event) => event.event === 'token')
    .map((event) => String(event.data.text))
    .join('');
  return { raw, tokens, final, bubble: bots.nth(before) };
}

async function runRows(page: Page, rows: readonly Row[], refusal: string) {
  const bodies = await captureChatBodies(page);
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (isChatPost(request)) requests.push(request);
  });
  const panel = page.getByRole('complementary', { name: '가격정책 챗봇' });
  for (const row of rows) {
    const { raw, tokens, final, bubble } = await ask(page, bodies, row.input);
    if (row.verdict === 'R') {
      // 출력 가드 교체본 (precheck 거부면 mode=refusal·intent=cost — 표식 우회가 실제로 LLM 까지 갔는지)
      expect(final, row.input).toMatchObject({ mode: 'llm', reply: refusal });
      await expect(bubble).toHaveText(refusal);
      expect(raw, `SSE 본문에 금액(${row.amount})`).not.toContain(row.amount!);
      expect(tokens).not.toContain(row.amount!);
    } else {
      const expected = mirrored(row.input);
      expect(final, row.input).toMatchObject({ mode: 'llm', reply: expected });
      expect(tokens).toBe(expected);
      await expect(bubble).toHaveText(expected);
    }
  }
  // 봇 말풍선 DOM 전체에 금액 원문 0회 (사용자 말풍선은 본인이 입력한 원문이라 제외)
  const botTexts = (await panel.locator('[data-from="bot"]').allTextContents()).join('\n');
  // 대화 기록: 요청마다 보낸 history 의 assistant 항목. 클라이언트는 최근 HISTORY_TURNS(10)개만 보내므로
  // 마지막 요청 하나로는 모든 행을 볼 수 없다 → 요청 i 의 마지막 assistant 항목 = 행 i-1 의 답(R행이면 거부 문구)
  const assistantOf = (request: Request) =>
    (
      (request.postDataJSON() as { history?: { role: string; text: string }[] }).history ?? []
    ).filter((item) => item.role === 'assistant');
  expect(requests).toHaveLength(rows.length);
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    expect(assistantOf(requests[index]!).at(-1)?.text, previous.input).toBe(
      previous.verdict === 'R' ? refusal : mirrored(previous.input),
    );
  }
  const historyText = requests
    .flatMap(assistantOf)
    .map((item) => item.text)
    .join('\n');
  for (const row of rows.filter((entry) => entry.verdict === 'R')) {
    expect(botTexts, `봇 말풍선에 ${row.amount}`).not.toContain(row.amount!);
    expect(historyText, `대화 기록에 ${row.amount}`).not.toContain(row.amount!);
  }
}

async function openReadyPanel(page: Page) {
  // 저장한 키로 상태를 새로 읽게 한 번 새로고침 → LLM 연결(SSE 경로)인지 과금 고지로 확인
  await page.reload();
  await page.getByRole('button', { name: '챗봇', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '가격정책 챗봇' });
  await expect(panel.getByRole('note', { name: '과금 안내' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(clearCredentials);
test.afterAll(clearCredentials);

test('행 구성: 청크 경계에 금액이 걸치는 R행 1건 이상, 역할별 R·K 행', () => {
  expect([...USER_ROWS, ...ADMIN_ROWS].filter(straddlesChunk).length).toBeGreaterThanOrEqual(1);
  expect(straddlesChunk(USER_ROWS[0]!)).toBe(true);
  for (const rows of [USER_ROWS, ADMIN_ROWS]) {
    expect(rows.some((row) => row.verdict === 'R')).toBe(true);
    expect(rows.some((row) => row.verdict === 'K')).toBe(true);
    // 200자 입력 절단(intent.ts CHAT_MAX_LENGTH) 안쪽
    for (const row of rows) expect(row.input.length).toBeLessThanOrEqual(200);
  }
});

test('USER: 미러 키 → R행은 일반 사용자 거부 문구·금액 0회, K행은 입력 그대로', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loginAs(page, FIXTURE_USER, '/settings');
  await warmUpChatRoute(page);
  await saveMirrorKey(page);
  await openReadyPanel(page);
  await runRows(page, USER_ROWS, COST_REPLY_USER);
});

test('ADMIN: 미러 키 → R행은 관리자 거부 문구·금액 0회, K행은 입력 그대로', async ({ page }) => {
  test.setTimeout(180_000);
  await loginAs(page, FIXTURE_ADMIN, '/settings');
  await saveMirrorKey(page);
  await openReadyPanel(page);
  await runRows(page, ADMIN_ROWS, COST_REPLY_ADMIN);
});
