import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * 서버 표 빠른 필터 바 테스트 헬퍼 (표 열 필터 빠른 필터 바 §2 — 필드 버튼 = 칩, "＋ N개 더", enum 즉시 적용·400ms 디바운스).
 * 바(role=group "필터") 안의 필드 버튼을 바로 누르거나, 고정 아닌 필드는 "＋ N개 더" → 필드 목록에서 고른다.
 */

/** 정규식 특수문자 이스케이프 */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 빠른 필터 바 (페이지 필터가 있으면 카드 안의 바 줄) */
export const quickBar = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-quick-filter-bar]') ??
  (() => {
    throw new Error('빠른 필터 바 없음');
  })();

/** 바에 보이는 필드 버튼의 열 이름 (고정 + 조건이 걸린 필드, 필드 순서) */
export const barFields = (): string[] =>
  [...quickBar().querySelectorAll<HTMLElement>('[data-quick-field]')].map(
    (button) => (button.getAttribute('aria-label') ?? '').split(' 필터')[0] ?? '',
  );

/** 조건이 걸린 필드 버튼의 보이는 요약 ("상태: 운영중") — 옛 '적용된 필터' 칩 줄 대신 */
export const activeFields = (): string[] =>
  [...quickBar().querySelectorAll<HTMLElement>('[data-quick-field]')]
    .filter((button) => (button.getAttribute('aria-label') ?? '').endsWith('적용 중'))
    .map((button) => (button.textContent ?? '').replace('▾', '').trim());

/** "＋ N개 더" 안의 열 이름 (없으면 []) */
export async function moreFields(user: UserEvent): Promise<string[]> {
  const more = within(quickBar()).queryByRole('button', { name: /^＋ \d+개 더$/ });
  if (!more) return [];
  await user.click(more);
  const dialog = await screen.findByRole('dialog', { name: '필터 더 보기' });
  const names = within(dialog)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '필터 더 보기' })).not.toBeInTheDocument(),
  );
  return names;
}

/** 그 열의 편집 팝오버를 연다 — 바에 버튼이 있으면 그 버튼, 없으면 "＋ N개 더" → 열 */
export async function openField(user: UserEvent, column: string): Promise<HTMLElement> {
  const button = within(quickBar()).queryByRole('button', {
    name: new RegExp(`^${escape(column)} 필터(, |$)`),
  });
  if (button) {
    await user.click(button);
  } else {
    await user.click(within(quickBar()).getByRole('button', { name: /^＋ \d+개 더$/ }));
    const list = await screen.findByRole('dialog', { name: '필터 더 보기' });
    await user.click(within(list).getByRole('button', { name: column }));
  }
  return screen.findByRole('dialog', { name: `${column} 필터` });
}

/** text·range 열: 열고 fill → "적용", 팝오버가 닫힐 때까지 기다린다 */
export async function applyField(
  user: UserEvent,
  column: string,
  fill: (dialog: HTMLElement) => Promise<void>,
) {
  const dialog = await openField(user, column);
  await fill(dialog);
  await user.click(within(dialog).getByRole('button', { name: '적용' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: `${column} 필터` })).not.toBeInTheDocument(),
  );
}

/**
 * enum 열: 열고 체크(즉시 적용 — 서버 표는 마지막 체크 후 400ms 디바운스) → navigated 가 참이 될 때까지 기다린 뒤 Esc 로 닫는다.
 * navigated: 이동 mock 이 새로 불렸는지 확인하는 함수(예: () => mocks.replace.mock.calls.length > before)
 */
export async function toggleField(
  user: UserEvent,
  column: string,
  labels: readonly string[],
  navigated: () => boolean,
) {
  const dialog = await openField(user, column);
  for (const label of labels)
    await user.click(within(dialog).getByRole('checkbox', { name: label }));
  await waitFor(() => expect(navigated()).toBe(true), { timeout: 2000 });
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: `${column} 필터` })).not.toBeInTheDocument(),
  );
}

/** text 열: 값 입력 (연산자 기본 '포함', op 를 주면 그 버튼을 누른다) */
export const typeText =
  (user: UserEvent, value: string, op?: '포함' | '같음') => async (dialog: HTMLElement) => {
    if (op) await user.click(within(dialog).getByRole('button', { name: op }));
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), value);
  };

/** number/money/date 열: 범위 입력 (money 는 currency 를 주면 통화 라디오를 먼저 고른다) */
export const range =
  (
    user: UserEvent,
    from: string | null,
    to: string | null,
    kind: 'number' | 'date' = 'number',
    currency?: string,
  ) =>
  async (dialog: HTMLElement) => {
    if (currency) await user.click(within(dialog).getByRole('radio', { name: currency }));
    const [lo, hi] = kind === 'date' ? ['시작일', '종료일'] : ['최소', '최대'];
    // date 입력은 jsdom 에서 타이핑이 아니라 값 변경으로 넣는다
    const put = async (label: string, value: string) => {
      const input = within(dialog).getByLabelText(label);
      if (kind === 'date') fireEvent.change(input, { target: { value } });
      else await user.type(input, value);
    };
    if (from !== null) await put(lo, from);
    if (to !== null) await put(hi, to);
  };
