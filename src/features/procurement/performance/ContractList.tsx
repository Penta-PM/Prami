'use client';

import { Icon } from '@/components/icons/Icon';
import { ViewStateLink } from '@/features/page-state/ViewStateLink';
import { cn } from '@/lib/cn';
import { formatMonthShort, type MonthKey } from '@/lib/month';
import { formatEokMan, formatMillionWon, millionWonHeader } from '@/lib/procurement/format';
import { isOurManufacturer } from '@/lib/procurement/our-company';
import type { MonthContractRow } from '@/server/procurement/performance';

import { displayName } from './model';

export type ContractListData = {
  rows: readonly MonthContractRow[];
  total: number;
  page: number;
  pageCount: number;
  /** 선택 범위 전체 금액 */
  amount: number;
};

export type ContractListProps = {
  month: MonthKey;
  /** 제조사 한정 이름 (없으면 "전체") */
  manufacturerLabel: string | null;
  data: ContractListData;
  onClose: () => void;
  /** 페이지 이동 주소 (URL 상태) */
  pageHref: (page: number) => string;
};

const TH =
  'sticky top-0 z-[1] border-b border-border-default bg-surface-muted px-2.5 py-2 text-left text-[12px] font-semibold whitespace-nowrap text-text-secondary';
const TD = 'border-b border-border-subtle px-2.5 py-2 text-[13px] text-text-primary';

/** 날짜(YYYY-MM-DD) → 원본 표기 YYYYMMDD 대신 읽기 쉬운 `YYYY.MM.DD` */
const dateText = (value: string | null) => (value ? value.replaceAll('-', '.') : '—');

/**
 * 월 계약 목록 (원본 CompetitorLineChart 의 "계약 목록" — 차트에서 고른 달): 제목 "{제조사|전체} · {yy.mm} 계약 목록 (N건 · 금액)",
 * 닫기, 열 = 납품요구일자 · 제조사 · 납품요구번호 · 수요기관 · 계약번호 · 물품식별명 · 납품금액. 서버 페이지네이션(URL 상태).
 * 표 금액 = 백만원(D-3), 제목 합계 = 억·만. 표는 이 칸 안에서만 스크롤한다.
 */
export function ContractList({
  month,
  manufacturerLabel,
  data,
  onClose,
  pageHref,
}: ContractListProps) {
  const heading = `${manufacturerLabel ?? '전체'} · ${formatMonthShort(month)} 계약 목록`;
  return (
    <section
      aria-label={heading}
      data-testid="month-contracts"
      className="flex min-w-0 flex-col gap-2.5 border-t border-border-subtle pt-5"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-semibold break-keep text-text-primary">
          {heading}{' '}
          <span className="font-normal text-text-secondary tabular-nums">
            ({data.total.toLocaleString('ko-KR')}건 · {formatEokMan(data.amount)})
          </span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-[12px] text-text-tertiary hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
        >
          닫기
          <Icon name="close" />
        </button>
      </div>
      <div className="max-h-[360px] w-full min-w-0 overflow-auto rounded-xl shadow-(--hairline-default)">
        <table aria-label={heading} className="w-full border-collapse">
          <thead>
            <tr>
              {['납품요구일자', '제조사', '납품요구번호', '수요기관', '계약번호', '물품식별명'].map(
                (column) => (
                  <th key={column} scope="col" className={TH}>
                    {column}
                  </th>
                ),
              )}
              <th scope="col" className={cn(TH, 'text-right')}>
                {millionWonHeader('납품금액')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={cn(TD, 'text-center text-text-tertiary')}>
                  이 달의 계약이 없습니다
                </td>
              </tr>
            ) : (
              data.rows.map((row) => {
                const ours = isOurManufacturer(row.manufacturer);
                return (
                  <tr key={row.id} data-contract-row={row.id}>
                    <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                      {dateText(row.dlvrReqDate)}
                    </td>
                    <td
                      className={cn(TD, 'whitespace-nowrap', ours && 'font-bold text-accent-ours')}
                      title={row.manufacturer ?? undefined}
                    >
                      {displayName(row.manufacturer)}
                    </td>
                    <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{row.dlvrReqNo}</td>
                    <td className={cn(TD, 'min-w-[120px]')}>{row.demandOrg ?? '—'}</td>
                    <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                      {row.contractNo ?? '—'}
                    </td>
                    <td className={cn(TD, 'min-w-[140px]')}>{row.itemName ?? '—'}</td>
                    <td
                      className={cn(TD, 'text-right font-semibold whitespace-nowrap tabular-nums')}
                    >
                      {formatMillionWon(row.amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {data.pageCount > 1 && (
        <nav
          aria-label="계약 목록 페이지"
          className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-tertiary"
        >
          <span className="tabular-nums">
            {data.page} / {data.pageCount} 페이지
          </span>
          <div className="flex gap-2">
            <PageLink href={pageHref(data.page - 1)} disabled={data.page <= 1} label="이전" />
            <PageLink
              href={pageHref(data.page + 1)}
              disabled={data.page >= data.pageCount}
              label="다음"
            />
          </div>
        </nav>
      )}
    </section>
  );
}

const PAGE_LINK_BASE =
  'inline-flex h-8 items-center rounded-lg bg-gray-75 px-3 font-semibold no-underline shadow-(--hairline-subtle)';

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(PAGE_LINK_BASE, 'text-text-tertiary opacity-50')}>
        {label}
      </span>
    );
  }
  return (
    <ViewStateLink
      href={href}
      scroll={false}
      replace
      className={cn(
        PAGE_LINK_BASE,
        'text-text-secondary hover:bg-gray-100 hover:text-ink-900 hover:no-underline',
      )}
    >
      {label}
    </ViewStateLink>
  );
}
