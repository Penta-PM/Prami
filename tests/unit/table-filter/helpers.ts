import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** 정규식 특수문자 이스케이프 */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 표 열 필터 툴바로 조건 하나를 건다: "＋ 필터" → 열 선택 → `<열> 필터` 팝오버에서 fill → "적용".
 * scope: 툴바가 들어 있는 영역(모달 등). 팝오버가 닫힐 때까지 기다린다.
 */
export async function addFilter(
  user: UserEvent,
  column: string,
  fill: (dialog: HTMLElement) => Promise<void>,
  scope: HTMLElement = document.body,
) {
  await user.click(within(scope).getByRole('button', { name: '＋ 필터' }));
  const picker = await screen.findByRole('dialog', { name: '필터할 열 선택' });
  await user.click(within(picker).getByRole('button', { name: new RegExp(`^${escape(column)}`) }));
  const dialog = await screen.findByRole('dialog', { name: `${column} 필터` });
  await fill(dialog);
  await user.click(within(dialog).getByRole('button', { name: '적용' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: `${column} 필터` })).not.toBeInTheDocument(),
  );
}

/** text 열: 값 입력 (연산자는 기본 '포함', op 를 주면 '같음' 등 선택) */
export const typeText =
  (user: UserEvent, value: string, op?: '포함' | '같음') => async (dialog: HTMLElement) => {
    if (op) await user.selectOptions(within(dialog).getByRole('combobox', { name: '조건' }), op);
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), value);
  };

/** enum 열: 체크박스 선택 */
export const check =
  (user: UserEvent, ...labels: string[]) =>
  async (dialog: HTMLElement) => {
    for (const label of labels)
      await user.click(within(dialog).getByRole('checkbox', { name: label }));
  };

/** number/money/date 열: 범위 입력 */
export const range =
  (user: UserEvent, from: string | null, to: string | null, kind: 'number' | 'date' = 'number') =>
  async (dialog: HTMLElement) => {
    const [lo, hi] = kind === 'date' ? ['시작일', '종료일'] : ['최소', '최대'];
    if (from !== null) await user.type(within(dialog).getByLabelText(lo), from);
    if (to !== null) await user.type(within(dialog).getByLabelText(hi), to);
  };

export const chips = () => {
  const list = screen.queryByRole('list', { name: '적용된 필터' });
  return list
    ? within(list)
        .getAllByRole('listitem')
        .map((item) => item.firstElementChild?.textContent)
    : [];
};
