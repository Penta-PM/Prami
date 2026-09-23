import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuditFilters } from '@/features/audit/AuditFilters';
import { AuditPagination } from '@/features/audit/AuditPagination';
import { AuditTable } from '@/features/audit/AuditTable';
import { filterToQuery } from '@/features/audit/query';
import {
  csvCell,
  formatAuditTarget,
  summarizeJson,
  toAuditCsv,
  type AuditDisplayRow,
} from '@/lib/audit-format';

/** 감사 로그 화면 (디자인 열: 일시·사용자·행위·대상·변경 전·변경 후·IP·결과) */
const ROW: AuditDisplayRow = {
  id: 1,
  createdAt: new Date('2026-09-23T00:00:00Z'),
  actorLabel: 'admin@pentasecurity.com',
  action: 'user.update',
  targetType: 'user',
  targetLabel: 'member@pentasecurity.com',
  targetId: 'u-1',
  before: { role: 'USER' },
  after: { role: 'ADMIN' },
  ip: '10.0.0.1',
  result: 'success',
  reason: null,
};

const FILTER = { page: 2, from: '2026-09-01', to: undefined, action: 'user.update', actor: 'kim' };

describe('AuditTable', () => {
  it('디자인 열 순서와 변경 전/후 요약, 결과 필을 렌더한다', () => {
    render(
      <AuditTable rows={[ROW, { ...ROW, id: 2, result: 'denied', ip: null, before: null }]} />,
    );
    const table = screen.getByRole('table', { name: '감사 로그' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['일시', '사용자', '행위', '대상', '변경 전', '변경 후', 'IP', '결과']);
    expect(screen.getAllByText('2026-09-23 09:00:00')).toHaveLength(2);
    expect(screen.getAllByText('user · member@pentasecurity.com')).toHaveLength(2);
    expect(screen.getByText('role: USER')).toBeInTheDocument();
    expect(screen.getByText('성공')).toBeInTheDocument();
    expect(screen.getByText('거부')).toBeInTheDocument();
  });

  it('빈 결과 안내', () => {
    render(<AuditTable rows={[]} />);
    expect(screen.getByText('조건에 맞는 감사 로그가 없습니다.')).toBeInTheDocument();
  });
});

describe('AuditFilters / AuditPagination', () => {
  it('필터 폼은 현재 값을 채우고 GET 으로 제출한다', () => {
    render(<AuditFilters filter={FILTER} actions={['auth.login', 'user.update']} />);
    const form = screen.getByRole('form', { name: '감사 로그 필터' });
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('행위')).toHaveValue('user.update');
    expect(screen.getByLabelText('사용자')).toHaveValue('kim');
  });

  it('페이지 링크는 필터를 유지하고 끝에서는 비활성', () => {
    render(<AuditPagination filter={FILTER} page={2} pageCount={2} total={60} />);
    expect(screen.getByText('총 60건 · 2 / 2 페이지')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      '/admin/audit?from=2026-09-01&action=user.update&actor=kim',
    );
    expect(screen.getByText('다음')).toHaveAttribute('aria-disabled', 'true');
  });

  it('filterToQuery 는 빈 값·1페이지를 생략한다', () => {
    expect(filterToQuery({ page: 1 } as typeof FILTER)).toBe('');
    expect(filterToQuery({ ...FILTER, to: '2026-09-30' })).toBe(
      '?from=2026-09-01&to=2026-09-30&action=user.update&actor=kim&page=2',
    );
  });
});

describe('audit-format', () => {
  it('대상·JSON 요약', () => {
    expect(formatAuditTarget({ targetType: null, targetLabel: null, targetId: 'x' })).toBe('x');
    expect(formatAuditTarget({ targetType: 'route', targetLabel: null, targetId: null })).toBe(
      'route',
    );
    expect(summarizeJson({ a: null, b: 1 })).toBe('a: —, b: 1');
    expect(summarizeJson(null)).toBe('');
  });

  it('CSV: BOM·CRLF, 따옴표 이스케이프, 수식 주입 방지', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('plain')).toBe('plain');

    const csv = toAuditCsv([{ ...ROW, reason: '사유' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('일시,사용자,행위,대상,변경 전,변경 후,IP,결과,사유');
    expect(lines[1]).toBe(
      '2026-09-23 09:00:00,admin@pentasecurity.com,user.update,user · member@pentasecurity.com,role: USER,role: ADMIN,10.0.0.1,성공,사유',
    );
  });
});
