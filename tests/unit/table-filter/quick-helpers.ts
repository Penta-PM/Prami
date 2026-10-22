import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * 빠른 필터 바(DataTableQuickFilterBar) 를 쓰는 표의 단위 테스트 헬퍼 (표 열 필터 빠른 필터 바 §2.1·§2.3).
 * 옛 "＋ 필터" 흐름 헬퍼(helpers.ts)는 아직 옛 툴바를 쓰는 테스트용 — 옛 툴바를 지울 때 같이 지운다.
 */

/** 정규식 특수문자 이스케이프 */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 필드 버튼 접근성 이름 — 비활성 "{열} 필터", 활성 "{열} 필터, {값} 적용 중" */
const fieldName = (column: string) => new RegExp(`^${escape(column)} 필터(, .+ 적용 중)?$`);

/** 바의 필드 버튼 (고정 필드이거나 조건이 걸린 필드) */
export const fieldButton = (column: string, scope: HTMLElement = document.body) =>
  within(scope).getByRole('button', { name: fieldName(column) });

/**
 * 그 필드 편집 팝오버를 연다: 바에 버튼이 있으면 버튼(1클릭), 없으면 "＋ N개 더" → 필드. 열린 `<열> 필터` 대화상자를 돌려준다.
 */
export async function openField(
  user: UserEvent,
  column: string,
  scope: HTMLElement = document.body,
): Promise<HTMLElement> {
  const direct = within(scope).queryByRole('button', { name: fieldName(column) });
  if (direct) {
    await user.click(direct);
  } else {
    await user.click(within(scope).getByRole('button', { name: /^＋ \d+개 더$/ }));
    const picker = await screen.findByRole('dialog', { name: '필터 더 보기' });
    await user.click(within(picker).getByRole('button', { name: column }));
  }
  return screen.findByRole('dialog', { name: `${column} 필터` });
}

/** 팝오버가 닫힐 때까지 */
export const closed = (column: string) =>
  waitFor(() =>
    expect(screen.queryByRole('dialog', { name: `${column} 필터` })).not.toBeInTheDocument(),
  );

/**
 * 조건 하나를 건다: 필드 버튼(또는 "＋ N개 더") → fill → text·범위는 "적용", enum 은 즉시 적용이라 Esc 로 닫는다.
 * 날짜 프리셋처럼 fill 이 팝오버를 닫으면 그대로 둔다. 팝오버가 닫힐 때까지 기다린다.
 */
export async function quickFilter(
  user: UserEvent,
  column: string,
  fill: (dialog: HTMLElement) => Promise<void>,
  scope: HTMLElement = document.body,
) {
  await fill(await openField(user, column, scope));
  const dialog = screen.queryByRole('dialog', { name: `${column} 필터` });
  if (dialog) {
    const apply = within(dialog).queryByRole('button', { name: '적용' });
    if (apply) await user.click(apply);
    else await user.keyboard('{Escape}');
  }
  await closed(column);
}

/** text 열: 값 입력 (연산자는 기본 '포함', op 를 주면 '같음' 등 2버튼 토글) */
export const typeText =
  (user: UserEvent, value: string, op?: '포함' | '같음') => async (dialog: HTMLElement) => {
    if (op)
      await user.click(
        within(within(dialog).getByRole('group', { name: '조건' })).getByRole('button', {
          name: op,
        }),
      );
    await user.type(within(dialog).getByRole('textbox', { name: '값' }), value);
  };

/** enum 열: 체크박스 선택 (체크 즉시 적용) */
export const check =
  (user: UserEvent, ...labels: string[]) =>
  async (dialog: HTMLElement) => {
    for (const label of labels)
      await user.click(within(dialog).getByRole('checkbox', { name: label }));
  };

/** number/money/date 열: 범위 입력. currency 를 주면 money 팝오버 상단 통화 라디오를 먼저 고른다 */
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
    if (from !== null) await user.type(within(dialog).getByLabelText(lo), from);
    if (to !== null) await user.type(within(dialog).getByLabelText(hi), to);
  };

/** 조건이 걸린 필드 버튼의 요약 (`{열}: {값}`, 필드 순) — 옛 '적용된 필터' 칩 줄 대신 */
export const activeFields = (scope: HTMLElement = document.body) =>
  within(scope)
    .queryAllByRole('button', { name: / 적용 중$/ })
    .filter((button) => button.hasAttribute('data-quick-field'))
    .map((button) => button.textContent?.replace(/▾$/, ''));
