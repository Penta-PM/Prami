import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox, Radio } from '@/components/ui';

/**
 * 공용 Checkbox·Radio (빠른 필터 바 디자인 보정 §7.3) — 네이티브 input(appearance-none) + SVG 표시.
 * 레이블 연결·키보드·접근성 이름은 네이티브 그대로, 상태별 클래스(테두리·checked·focus-visible·disabled)와 indeterminate.
 */
function box(input: HTMLElement) {
  return input.parentElement as HTMLElement;
}

describe('Checkbox', () => {
  it('네이티브 checkbox — 레이블 이름, 클릭·Space 로 토글, onChange', async () => {
    const onChange = vi.fn();
    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <label>
          <Checkbox
            checked={checked}
            onChange={(event) => {
              onChange(event.target.checked);
              setChecked(event.target.checked);
            }}
          />
          중요 공지
        </label>
      );
    }
    render(<Harness />);
    const input = screen.getByRole('checkbox', { name: '중요 공지' });
    expect(input).toHaveAttribute('type', 'checkbox');
    expect(input).not.toBeChecked();
    await userEvent.click(screen.getByText('중요 공지'));
    expect(input).toBeChecked();
    input.focus();
    await userEvent.keyboard(' ');
    expect(input).not.toBeChecked();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('기본 상자: appearance-none, 테두리 1.5px slate-600-aa(border-default 아님), checked·indeterminate = purple-600, hover 는 미체크만', () => {
    render(<Checkbox aria-label="x" />);
    const input = screen.getByRole('checkbox', { name: 'x' });
    expect(input).toHaveClass(
      'appearance-none',
      'border-[1.5px]',
      'border-slate-600-aa',
      'bg-white',
      'checked:bg-purple-600',
      'checked:border-purple-600',
      'indeterminate:bg-purple-600',
      'enabled:hover:not-checked:not-indeterminate:border-ink-900',
      'enabled:hover:not-checked:not-indeterminate:bg-gray-75',
      'rounded-[4px]',
    );
    expect(input.className).not.toMatch(/border-default|accent-/);
  });

  it('focus-visible: 2px purple-500 outline offset 2 (Button 과 같은 값)', () => {
    render(<Checkbox aria-label="x" />);
    expect(screen.getByRole('checkbox', { name: 'x' })).toHaveClass(
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-purple-500',
    );
  });

  it('체크 표시: 체크면 ✓(peer-checked), indeterminate 면 가로선 — SVG 는 aria-hidden', () => {
    render(<Checkbox aria-label="x" />);
    const input = screen.getByRole('checkbox', { name: 'x' });
    const [check, minus] = box(input).querySelectorAll('svg');
    expect(check).toHaveAttribute('aria-hidden', 'true');
    expect(check).toHaveClass('hidden', 'peer-checked:block', 'peer-indeterminate:hidden');
    expect(minus).toHaveClass('hidden', 'peer-indeterminate:block');
    expect(input).toHaveClass('peer');
  });

  it('indeterminate: DOM 속성으로 반영(mixed), 값이 바뀌면 다시 반영', () => {
    const { rerender } = render(<Checkbox aria-label="전체" indeterminate />);
    const input = screen.getByRole<HTMLInputElement>('checkbox', { name: '전체' });
    expect(input.indeterminate).toBe(true);
    expect(input).toBePartiallyChecked();
    rerender(<Checkbox aria-label="전체" indeterminate={false} checked readOnly />);
    expect(input.indeterminate).toBe(false);
    expect(input).toBeChecked();
  });

  it('disabled: 비활성 + opacity-50, 클릭해도 바뀌지 않음', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="x" disabled onChange={onChange} />);
    const input = screen.getByRole('checkbox', { name: 'x' });
    expect(input).toBeDisabled();
    expect(input).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
    await userEvent.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('크기: md 18px 기본, sm 16px', () => {
    render(
      <>
        <Checkbox aria-label="md" />
        <Checkbox aria-label="sm" size="sm" />
      </>,
    );
    expect(box(screen.getByRole('checkbox', { name: 'md' }))).toHaveClass('size-[18px]');
    expect(box(screen.getByRole('checkbox', { name: 'sm' }))).toHaveClass('size-4');
  });

  it('ref 를 네이티브 input 에 넘기고, 폼 제출 값(name·defaultChecked)은 네이티브 그대로', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <form aria-label="f">
        <Checkbox ref={ref} name="isImportant" defaultChecked aria-label="x" />
      </form>,
    );
    expect(ref.current).toBe(screen.getByRole('checkbox', { name: 'x' }));
    const data = new FormData(screen.getByRole('form', { name: 'f' }) as HTMLFormElement);
    expect(data.get('isImportant')).toBe('on');
  });
});

describe('Radio', () => {
  it('같은 name 끼리 하나만 선택, 원형 + 가운데 점 8px, 같은 상태 클래스', async () => {
    render(
      <fieldset>
        <label>
          <Radio name="cur" value="KRW" />
          KRW
        </label>
        <label>
          <Radio name="cur" value="USD" size="sm" />
          USD
        </label>
      </fieldset>,
    );
    const krw = screen.getByRole('radio', { name: 'KRW' });
    const usd = screen.getByRole('radio', { name: 'USD' });
    await userEvent.click(screen.getByText('KRW'));
    expect(krw).toBeChecked();
    await userEvent.click(screen.getByText('USD'));
    expect(usd).toBeChecked();
    expect(krw).not.toBeChecked();
    expect(krw).toHaveClass(
      'appearance-none',
      'rounded-full',
      'border-slate-600-aa',
      'checked:bg-purple-600',
      'focus-visible:outline-purple-500',
      'disabled:opacity-50',
    );
    const dot = box(krw).querySelector('[aria-hidden="true"]');
    expect(dot).toHaveClass('size-2', 'rounded-full', 'bg-white', 'hidden', 'peer-checked:block');
    expect(box(krw)).toHaveClass('size-[18px]');
    expect(box(usd)).toHaveClass('size-4');
  });

  it('disabled 라디오는 선택되지 않는다', async () => {
    render(
      <label>
        <Radio name="r" disabled />끔
      </label>,
    );
    await userEvent.click(screen.getByText('끔'));
    expect(screen.getByRole('radio', { name: '끔' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '끔' })).toBeDisabled();
  });
});

describe('앱 전체 적용 (§7.3 — 필터 2곳 + 폼 8곳)', () => {
  const ROOT = process.cwd();
  const sources = (): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name))
          out.push({ file: path.relative(ROOT, full), text: readFileSync(full, 'utf8') });
      }
    };
    walk(path.join(ROOT, 'src'));
    return out;
  };

  it('src 에 네이티브 checkbox·radio(type="checkbox|radio")·accent- 체크 색이 공용 컴포넌트 밖에 없다', () => {
    const hits = sources()
      .filter(({ file }) => !file.endsWith(path.join('components', 'ui', 'checkbox.tsx')))
      .filter(({ text }) => /type="(checkbox|radio)"|\baccent-purple/.test(text))
      .map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it('10곳이 공용 Checkbox·Radio 를 쓴다', () => {
    const uses = (file: string, tag: string) =>
      (readFileSync(path.join(ROOT, file), 'utf8').match(new RegExp(`<${tag}\\b`, 'g')) ?? [])
        .length;
    expect(uses('src/components/ui/data-table/QuickFilterEditor.tsx', 'Checkbox')).toBe(1);
    expect(uses('src/components/ui/data-table/QuickFilterEditor.tsx', 'Radio')).toBe(1);
    for (const file of [
      'src/features/notices/NoticeFormModal.tsx',
      'src/features/calculator/GroupSolution.tsx',
      'src/features/calculator/QuoteSteps.tsx',
      'src/features/parts/PartsEditor.tsx',
      'src/features/groups/GroupFormModal.tsx',
      'src/features/pricing/PolicyFormModal.tsx',
    ])
      expect(uses(file, 'Checkbox'), file).toBe(1);
    expect(uses('src/features/costs/CostLinkManager.tsx', 'Checkbox')).toBe(3);
  });
});
