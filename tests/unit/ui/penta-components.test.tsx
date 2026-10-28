import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  Card,
  Checkbox,
  DENSITY_METRICS,
  DensityScope,
  Drawer,
  Input,
  Modal,
  Pill,
  Radio,
  Segmented,
  Select,
  Table,
  TableBody,
  TableCell,
  TableRow,
  type Density,
} from '@/components/ui';
import {
  DataTable,
  DataTableQuickFilterBar,
  filterFieldsOf,
  type DataTableColumn,
} from '@/components/ui/data-table';
import { chipClass } from '@/components/ui/chip';

/**
 * Penta 디자인 PR-2 — 공용 컴포넌트 값(§3)·밀도 규칙(Q-D1 = B)·포커스 고리·대비.
 *
 * 밀도는 CSS 변수 상속이라 jsdom 이 계산하지 못한다. 그래서 (1) globals.css 의 [data-density] 블록을 읽어 밀도별 실제 값을
 * 해석하고 (2) 요소의 높이·글자 클래스 + 가장 가까운 data-density 조상으로 "브라우저가 계산할 값"을 재현해 단언한다.
 */
const globalsCss = readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')
  // 주석 안의 선택자·선언을 읽지 않는다
  .replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsIn(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    map.set(match[1]!, match[2]!.trim());
  return map;
}

/** 선택자로 시작하는 블록 본문 */
function blockAfter(selector: string): string {
  const start = globalsCss.indexOf(selector);
  expect(start, `${selector} 블록이 globals.css 에 있어야 합니다`).toBeGreaterThanOrEqual(0);
  const open = globalsCss.indexOf('{', start);
  return globalsCss.slice(open + 1, globalsCss.indexOf('}', open));
}

const allDeclarations = declarationsIn(globalsCss);

/** var(--x) 를 따라가 최종 값까지 (밀도 블록 → 전역 토큰) */
function resolve(value: string, scope: Map<string, string>): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value;
  const next = scope.get(ref[1]!) ?? allDeclarations.get(ref[1]!);
  expect(next, `${ref[1]} 정의`).toBeDefined();
  return resolve(next!, scope);
}

const DENSITY_BLOCKS: Record<Density, Map<string, string>> = {
  md: declarationsIn(blockAfter(":root,\n  [data-density='md']")),
  sm: declarationsIn(blockAfter("[data-density='sm'] {")),
};

function densityValue(density: Density, name: string): string {
  const block = DENSITY_BLOCKS[density];
  expect(block.get(name), `${density} 의 ${name}`).toBeDefined();
  return resolve(block.get(name)!, block);
}

/** 요소의 실제 높이·글자 크기(px) — 클래스 + 가장 가까운 data-density 조상(없으면 :root = md) */
function controlMetrics(el: Element): { height: number; fontSize: number } {
  const classes = el.classList;
  const density = (el.closest('[data-density]')?.getAttribute('data-density') ?? 'md') as Density;
  const px = (value: string) => Number(/^(\d+)px$/.exec(value)?.[1] ?? NaN);

  let height = NaN;
  if (classes.contains('h-(--density-control-height)'))
    height = px(densityValue(density, '--density-control-height'));
  for (const size of ['sm', 'md', 'lg'])
    if (classes.contains(`h-(--height-control-${size})`))
      height = px(resolve(`var(--height-control-${size})`, new Map()));

  let fontSize = NaN;
  if (classes.contains('text-(length:--density-font-size)'))
    fontSize = px(densityValue(density, '--density-font-size'));
  const fixed = [...classes].map((name) => /^text-\[(\d+)px\]$/.exec(name)?.[1]).find(Boolean);
  if (fixed) fontSize = Number(fixed);

  return { height, fontSize };
}

const SM = { height: 36, fontSize: 14 };
const MD = { height: 44, fontSize: 16 };

describe('밀도 토큰 (globals.css [data-density])', () => {
  it('sm = 36px·14px, md(:root 기본) = 44px·16px — DENSITY_METRICS 와 같다', () => {
    for (const density of ['sm', 'md'] as const) {
      expect(densityValue(density, '--density-control-height')).toBe(
        `${DENSITY_METRICS[density].height}px`,
      );
      expect(densityValue(density, '--density-font-size')).toBe(
        `${DENSITY_METRICS[density].fontSize}px`,
      );
    }
    expect(DENSITY_METRICS).toEqual({ sm: SM, md: MD });
  });
});

type Row = { id: string; name: string; role: 'ADMIN' | 'USER' };
const ROWS: Row[] = [{ id: '1', name: 'alpha', role: 'USER' }];
const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: '이름',
    type: 'text',
    sortValue: (r) => r.name,
    filter: { kind: 'text', quick: true },
    cell: (r) => r.name,
  },
  {
    id: 'role',
    header: '역할',
    type: 'status',
    sortValue: (r) => r.role,
    filter: {
      kind: 'enum',
      options: [
        { value: 'ADMIN', label: '관리자' },
        { value: 'USER', label: '사용자' },
      ],
    },
    cell: (r) => r.role,
  },
  {
    id: 'actions',
    header: '관리',
    type: 'none',
    cell: (r) => (
      <span className="flex gap-1">
        <Button>{`${r.name} 수정`}</Button>
        <Select aria-label={`${r.name} 역할`} defaultValue={r.role}>
          <option value="ADMIN">관리자</option>
          <option value="USER">사용자</option>
        </Select>
      </span>
    ),
  },
];

describe('Q-D1 = B: 밀집 컨테이너 안 컨트롤은 36px·14px', () => {
  it('DataTable 칸 안의 Button·Select (size 없음) → sm', () => {
    render(
      <DataTable
        tableId="penta"
        userId="u1"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        aria-label="표"
      />,
    );
    expect(controlMetrics(screen.getByRole('button', { name: 'alpha 수정' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('combobox', { name: 'alpha 역할' }))).toEqual(SM);
  });

  it('Table 프리미티브(관리 목록 등) 안 Button → sm, 본문 글자 14', () => {
    render(
      <Table aria-label="목록">
        <TableBody>
          <TableRow>
            <TableCell>
              <Button>삭제</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(controlMetrics(screen.getByRole('button', { name: '삭제' }))).toEqual(SM);
    expect(screen.getByRole('table', { name: '목록' })).toHaveClass('text-[14px]');
  });

  it('빠른 필터 바: 필드 칩·＋N개 더·페이지 필터(leading) Input·Button → sm', () => {
    render(
      <DataTableQuickFilterBar
        fields={filterFieldsOf(COLUMNS).filter((field) => field.id !== 'actions')}
        filters={[]}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        rows={ROWS}
        leading={
          <span>
            <Input aria-label="검색어" />
            <Button>검색</Button>
          </span>
        }
      />,
    );
    expect(controlMetrics(screen.getByRole('button', { name: '이름 필터' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('button', { name: '＋ 1개 더' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('textbox', { name: '검색어' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('button', { name: '검색' }))).toEqual(SM);
  });

  it('빠른 필터 편집 팝오버(바 안에 렌더) 의 입력·적용 버튼 → sm', async () => {
    render(
      <DataTableQuickFilterBar
        fields={filterFieldsOf(COLUMNS).filter((field) => field.id !== 'actions')}
        filters={[]}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        rows={ROWS}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '이름 필터' }));
    const dialog = await screen.findByRole('dialog', { name: '이름 필터' });
    expect(controlMetrics(within(dialog).getByRole('textbox', { name: '값' }))).toEqual(SM);
    expect(controlMetrics(within(dialog).getByRole('button', { name: '적용' }))).toEqual(SM);
  });

  it('Drawer 안 Input·Select·Button·Segmented → sm', () => {
    render(
      <Drawer open onClose={vi.fn()} title="상세">
        <Input aria-label="메모" />
        <Select aria-label="상태">
          <option>a</option>
        </Select>
        <Button variant="primary">저장</Button>
        <Segmented
          aria-label="보기"
          value="a"
          onChange={vi.fn()}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
      </Drawer>,
    );
    expect(controlMetrics(screen.getByRole('textbox', { name: '메모' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('combobox', { name: '상태' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('button', { name: '저장' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('radiogroup', { name: '보기' }))).toEqual(SM);
  });

  it('DensityScope(기본 sm) — 공용 밀집 컴포넌트가 아닌 관리 목록 영역', () => {
    render(
      <DensityScope>
        <Button>추가</Button>
      </DensityScope>,
    );
    expect(controlMetrics(screen.getByRole('button', { name: '추가' }))).toEqual(SM);
  });
});

describe('Q-D1 = B: 폼·독립 버튼·모달 주요 버튼은 44px·16px', () => {
  it('폼 안 Input·Select·Button (컨테이너 없음 = :root md)', () => {
    render(
      <form aria-label="등록">
        <Input aria-label="이름" />
        <Select aria-label="구분">
          <option>a</option>
        </Select>
        <Button type="submit" variant="primary">
          등록
        </Button>
      </form>,
    );
    expect(controlMetrics(screen.getByRole('textbox', { name: '이름' }))).toEqual(MD);
    expect(controlMetrics(screen.getByRole('combobox', { name: '구분' }))).toEqual(MD);
    expect(controlMetrics(screen.getByRole('button', { name: '등록' }))).toEqual(MD);
  });

  it('모달 footer 주요 버튼·본문 입력 → md — 밀집 컨테이너(드로어·표 영역) 안에서 열려도', () => {
    render(
      <DensityScope>
        <Modal open onClose={vi.fn()} title="수정" footer={<Button variant="primary">저장</Button>}>
          <Input aria-label="사유" />
        </Modal>
      </DensityScope>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-density', 'md');
    expect(controlMetrics(within(dialog).getByRole('button', { name: '저장' }))).toEqual(MD);
    expect(controlMetrics(within(dialog).getByRole('textbox', { name: '사유' }))).toEqual(MD);
  });

  it('size 를 명시하면 컨테이너와 무관하게 고정된다 (예외는 prop 으로만)', () => {
    render(
      <>
        <DensityScope>
          <Button size="md">큰 버튼</Button>
        </DensityScope>
        <Button size="sm">작은 버튼</Button>
        <Input size="sm" aria-label="작은 입력" />
      </>,
    );
    expect(controlMetrics(screen.getByRole('button', { name: '큰 버튼' }))).toEqual(MD);
    expect(controlMetrics(screen.getByRole('button', { name: '작은 버튼' }))).toEqual(SM);
    expect(controlMetrics(screen.getByRole('textbox', { name: '작은 입력' }))).toEqual(SM);
  });

  it('필터 칩은 놓인 자리와 무관하게 sm (필터 = 밀집)', () => {
    render(
      <button type="button" className={chipClass(false)}>
        올해
      </button>,
    );
    expect(controlMetrics(screen.getByRole('button', { name: '올해' }))).toEqual(SM);
  });
});

describe('Penta §6 값', () => {
  it('Button: 반경 8 · 좌우 16 · SemiBold, variant 색', () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button>S</Button>
        <Button variant="danger">D</Button>
        <Button variant="ghost">G</Button>
      </>,
    );
    for (const name of ['P', 'S', 'D', 'G'])
      expect(screen.getByRole('button', { name })).toHaveClass(
        'rounded-control',
        'px-4',
        'font-semibold',
        'border',
      );
    expect(screen.getByRole('button', { name: 'P' })).toHaveClass(
      'bg-action-bg',
      'text-action-fg',
      'hover:bg-action-bg-hover',
    );
    expect(screen.getByRole('button', { name: 'S' })).toHaveClass(
      'bg-neutral-0',
      'text-primary-600',
      'border-primary-600',
    );
    expect(screen.getByRole('button', { name: 'D' })).toHaveClass('bg-danger-bg', 'text-white');
    expect(screen.getByRole('button', { name: 'G' })).toHaveClass(
      'bg-neutral-50',
      'text-neutral-700',
      'border-neutral-200',
    );
    // 500 단계는 글자·글자 배경에 쓰지 않는다
    for (const name of ['P', 'S', 'D', 'G'])
      expect(screen.getByRole('button', { name }).className).not.toMatch(
        /\b(?:bg|text)-(?:primary|error)-500\b/,
      );
  });

  it('Input·Select: 반경 8 · 좌우 12 · 테두리 N200 · 포커스 P500', () => {
    render(
      <>
        <Input aria-label="i" />
        <Select aria-label="s">
          <option>a</option>
        </Select>
      </>,
    );
    for (const el of [screen.getByRole('textbox'), screen.getByRole('combobox')])
      expect(el).toHaveClass(
        'rounded-control',
        'border',
        'border-neutral-200',
        'bg-neutral-0',
        'focus-visible:border-focus-ring',
        'focus-visible:outline-focus-ring',
      );
    expect(screen.getByRole('textbox')).toHaveClass('px-3', 'placeholder:text-text-placeholder');
    expect(screen.getByRole('combobox')).toHaveClass('pl-3');
  });

  it('Card: N0 · 1px N100 · 반경 12 · 그림자 md · 여백 20', () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId('card')).toHaveClass(
      'bg-neutral-0',
      'border',
      'border-neutral-100',
      'rounded-card',
      'shadow-card',
      'p-5',
    );
  });

  it('Status Badge 4종: 높이 28 · 반경 full · 12 SemiBold · X50 바탕 / X700 글자, Info 는 아이콘 동반', () => {
    render(
      <>
        <Pill tone="success">성공</Pill>
        <Pill tone="warning">주의</Pill>
        <Pill tone="error">오류</Pill>
        <Pill tone="info">안내</Pill>
      </>,
    );
    for (const [text, family] of [
      ['성공', 'success'],
      ['주의', 'warning'],
      ['오류', 'error'],
      ['안내', 'info'],
    ] as const) {
      const badge = screen.getByText(text);
      expect(badge).toHaveClass(
        'h-7',
        'rounded-pill',
        'px-2',
        'text-[12px]',
        'font-semibold',
        `bg-${family}-50`,
        `text-${family}-700`,
      );
    }
    // Info 700 은 Primary 600 과 1.2:1 — 색만으로 구분하지 않도록 아이콘(장식, aria-hidden)
    expect(screen.getByText('안내').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('성공').querySelector('svg')).toBeNull();
  });

  it('Modal: 반경 16 · 그림자 lg / Drawer: 그림자 xl', () => {
    const { unmount } = render(
      <Modal open onClose={vi.fn()} title="모달">
        x
      </Modal>,
    );
    const panel = screen.getByRole('heading', { name: '모달' }).parentElement!.parentElement!;
    expect(panel).toHaveClass('rounded-modal', 'shadow-modal');
    unmount();
    render(
      <Drawer open onClose={vi.fn()} title="드로어">
        x
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: '드로어' })).toHaveClass('shadow-panel');
    expect(screen.getByRole('dialog', { name: '드로어' })).toHaveAttribute('data-density', 'sm');
  });
});

describe('포커스 고리 — 모든 공용 컨트롤 focus-visible --focus-ring', () => {
  it('Button·CloseButton·Checkbox·Radio·Segmented·Input·Select·칩', () => {
    render(
      <>
        <Modal open onClose={vi.fn()} title="m">
          <Button>버튼</Button>
          <Checkbox aria-label="체크" />
          <Radio aria-label="라디오" />
          <Segmented
            aria-label="seg"
            value="a"
            onChange={vi.fn()}
            options={[{ value: 'a', label: 'A' }]}
          />
          <Input aria-label="입력" />
          <Select aria-label="선택">
            <option>a</option>
          </Select>
          <button type="button" className={chipClass(true)}>
            칩
          </button>
        </Modal>
      </>,
    );
    for (const el of [
      screen.getByRole('button', { name: '버튼' }),
      screen.getByRole('button', { name: '닫기' }),
      screen.getByRole('checkbox', { name: '체크' }),
      screen.getByRole('radio', { name: '라디오' }),
      screen.getByRole('radio', { name: 'A' }),
      screen.getByRole('textbox', { name: '입력' }),
      screen.getByRole('combobox', { name: '선택' }),
      screen.getByRole('button', { name: '칩' }),
    ])
      expect(el, el.getAttribute('aria-label') ?? el.textContent ?? '').toHaveClass(
        'focus-visible:outline-2',
        'focus-visible:outline-focus-ring',
      );
  });
});

/* ── 컴포넌트 글자/바탕 짝 대비 (tokens.test 의 팔레트 검사에 없는 짝만) ── */

function hexOf(name: string): number[] {
  const value = resolve(`var(${name})`, new Map());
  expect(value, name).toMatch(/^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
}
function luminance(color: number[]): number {
  const [r, g, b] = color.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(hexOf(fg)), luminance(hexOf(bg))].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('컴포넌트 글자 대비 AA 4.5:1', () => {
  it.each([
    ['Secondary 버튼', '--penta-primary-600', '--penta-neutral-0'],
    ['Secondary 버튼 hover', '--penta-primary-700', '--penta-primary-50'],
    ['Ghost 버튼', '--penta-neutral-700', '--penta-neutral-50'],
    ['Ghost 버튼 hover', '--penta-neutral-900', '--penta-neutral-100'],
    ['중립 배지', '--penta-neutral-700', '--penta-neutral-100'],
    ['Primary 배지', '--penta-primary-700', '--penta-primary-50'],
    ['사이드바 활성', '--penta-primary-700', '--penta-primary-50'],
    ['입력 자리표시', '--text-placeholder', '--penta-neutral-0'],
    ['Segmented 비활성', '--text-tertiary', '--penta-neutral-100'],
  ])('%s: %s on %s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
