'use client';

import { Fragment, useId, useState } from 'react';

import {
  FOCUS_RING_CLASSES,
  InfoHint,
  Pill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { controlSizeClasses } from '@/components/ui/density';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/date-format';
import { BID_FIT_HINT_LINES, BID_FIT_HINT_NAME } from '@/lib/procurement/copy';
import { formatEokMan } from '@/lib/procurement/format';

import {
  DEADLINE_TONE_CLASS,
  deadlineBadge,
  fitBadge,
  parseFitReason,
  reasonCounts,
  safeExternalUrl,
  type ReasonSign,
} from './display';

/** 표 한 줄 — server/procurement/bids BidNoticeRow 에서 화면이 쓰는 필드만 (RSC 경계로 Date 그대로 넘어온다) */
export type BidTableRow = {
  bidNo: string;
  bidOrd: string;
  title: string;
  products: string[];
  orderOrg: string | null;
  demandOrg: string | null;
  postedAt: Date | string | null;
  deadlineAt: Date | string | null;
  budget: number | null;
  estPrice: number | null;
  detailUrl: string | null;
  fitGrade: string | null;
  fitScore: number | null;
  fitReasons: string[];
  closed: boolean;
  daysLeft: number | null;
};

const COLUMNS = [
  '적합도',
  '관련 제품',
  '공고명',
  '수요기관',
  '공고일',
  '입찰 마감',
  '배정예산',
  '추정가격',
  '근거',
] as const;

/**
 * 입찰 공고 표 (조달이 통합 UI-3). 서버 페이지네이션 결과 한 페이지를 그린다.
 * - 적합도 = 등급 글자 + 색 + 점수(색만으로 구분하지 않음)
 * - 공고명 = 링크 + 외부 링크 아이콘. 새 창은 **링크로만** 연다(행에는 클릭 동작이 없다), rel=noopener noreferrer
 * - 근거 ＋/－ = 표 안 펼침 행(버튼 aria-expanded·aria-controls)
 * - 마감 = D-day 배지(임박 --accent-orange), 마감된 공고는 흐린 글자 + "마감" 배지
 * - 예산·추정가 = 억·만(D-3 요약 표기 — 스펙 UI-3)
 * 320px 에서도 페이지는 가로로 넘치지 않고 표만 표 안에서 스크롤한다(Table 래퍼 overflow-x-auto + min-w). sr-only 글자가 든 칸은 relative — 절대 위치 sr-only 가 스크롤 래퍼(위치 지정 없음) 밖 페이지 기준으로 놓여 페이지를 넓히지 않게.
 */
export function BidTable({ rows }: { rows: readonly BidTableRow[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const baseId = useId();

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Table aria-label="입찰 공고 목록" className="min-w-[1040px]">
      <TableHead>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHeaderCell
              key={column}
              className={column === '배정예산' || column === '추정가격' ? 'text-right' : undefined}
            >
              {column === '적합도' ? (
                <span className="inline-flex items-center gap-1">
                  {column}
                  <FitHint />
                </span>
              ) : (
                column
              )}
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const key = `${row.bidNo}-${row.bidOrd}`;
          const isOpen = expanded.has(key);
          const panelId = `${baseId}-reasons-${key}`;
          return (
            <Fragment key={key}>
              <BidRow row={row} isOpen={isOpen} panelId={panelId} onToggle={() => toggle(key)} />
              {isOpen ? (
                <tr id={panelId} className="border-b border-border-subtle bg-surface-muted">
                  <td colSpan={COLUMNS.length} className="relative px-3 py-3">
                    <ReasonList title={row.title} reasons={row.fitReasons} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * '적합도' 머리 옆 안내 (UX PR-U1 §3) — 기존 InfoHint(클릭·Enter·Space 로 열고 Esc·바깥 클릭·마우스 이탈로 닫힘).
 * 머리에는 정렬 클릭이 없어 충돌하지 않는다. 팝오버는 포털 없이 th 안에 그려지므로 th 의 nowrap·굵기를 되돌린다.
 */
function FitHint() {
  return (
    <InfoHint name={BID_FIT_HINT_NAME} align="start">
      <span className="flex flex-col gap-1 text-left font-normal whitespace-normal">
        {BID_FIT_HINT_LINES.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </InfoHint>
  );
}

function BidRow({
  row,
  isOpen,
  panelId,
  onToggle,
}: {
  row: BidTableRow;
  isOpen: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const fit = fitBadge(row.fitGrade, row.fitScore);
  const deadline = deadlineBadge(row);
  const href = safeExternalUrl(row.detailUrl);
  const counts = reasonCounts(row.fitReasons);
  const muted = row.closed;

  return (
    <TableRow
      data-closed={row.closed ? 'true' : undefined}
      className={cn(muted && 'bg-surface-muted')}
    >
      <TableCell className="relative">
        <Pill tone={fit.tone} className="gap-1 font-semibold" title={fit.label}>
          <span className="sr-only">{fit.label}</span>
          <span aria-hidden="true">{fit.grade}</span>
          {fit.score ? (
            <span aria-hidden="true" className="tabular-nums">
              {fit.score}
            </span>
          ) : null}
        </Pill>
      </TableCell>
      <TableCell className="text-[12px] text-text-secondary">{row.products.join(', ')}</TableCell>
      <TableCell className="relative max-w-[360px] min-w-[220px]">
        <div className="flex flex-col gap-0.5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-start gap-1 font-medium break-keep hover:underline',
                muted ? 'text-text-tertiary' : 'text-text-primary',
              )}
            >
              <span>{row.title}</span>
              <ExternalLinkIcon />
              <span className="sr-only">(새 창에서 공고 열기)</span>
            </a>
          ) : (
            <span
              className={cn(
                'font-medium break-keep',
                muted ? 'text-text-tertiary' : 'text-text-primary',
              )}
            >
              {row.title}
            </span>
          )}
          <span className="text-[12px] text-text-tertiary tabular-nums">
            {row.bidNo}-{row.bidOrd}
            {row.orderOrg ? ` · ${row.orderOrg}` : ''}
          </span>
        </div>
      </TableCell>
      <TableCell className={cn('min-w-[140px] break-keep', muted && 'text-text-tertiary')}>
        {row.demandOrg ?? '—'}
      </TableCell>
      <TableCell className="text-[12px] whitespace-nowrap text-text-secondary tabular-nums">
        {row.postedAt ? formatDate(row.postedAt) : '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex flex-col items-start gap-1">
          <span
            data-testid="bid-deadline-badge"
            data-tone={deadline.tone}
            className={cn(
              'inline-flex items-center rounded-pill px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap',
              DEADLINE_TONE_CLASS[deadline.tone],
            )}
          >
            {deadline.text}
          </span>
          {row.deadlineAt ? (
            <span className="text-[12px] text-text-tertiary tabular-nums">
              {formatDateTime(row.deadlineAt)}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell
        className={cn('text-right whitespace-nowrap tabular-nums', muted && 'text-text-tertiary')}
      >
        {formatEokMan(row.budget)}
      </TableCell>
      <TableCell
        className={cn('text-right whitespace-nowrap tabular-nums', muted && 'text-text-tertiary')}
      >
        {formatEokMan(row.estPrice)}
      </TableCell>
      <TableCell className="relative whitespace-nowrap">
        {row.fitReasons.length > 0 ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? panelId : undefined}
            onClick={onToggle}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-control border border-solid border-neutral-200 bg-neutral-50 px-3 font-semibold text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
              controlSizeClasses('sm'),
              FOCUS_RING_CLASSES,
            )}
          >
            <span>{isOpen ? '근거 접기' : '근거 보기'}</span>
            <span className="tabular-nums" aria-hidden="true">
              ＋{counts.plus} －{counts.minus}
            </span>
            <span className="sr-only">
              (가점 {counts.plus}개, 감점 {counts.minus}개)
            </span>
          </button>
        ) : (
          <span className="text-[12px] text-text-tertiary">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

const SIGN_STYLE: Record<ReasonSign, { mark: string; label: string; className: string }> = {
  plus: { mark: '＋', label: '가점', className: 'text-success-700' },
  minus: { mark: '－', label: '감점', className: 'text-text-danger' },
  none: { mark: '·', label: '참고', className: 'text-text-tertiary' },
};

function ReasonList({ title, reasons }: { title: string; reasons: readonly string[] }) {
  return (
    <ul aria-label={`${title} 적합도 근거`} className="m-0 flex list-none flex-col gap-1 p-0">
      {reasons.map((reason, index) => {
        const { sign, text } = parseFitReason(reason);
        const style = SIGN_STYLE[sign];
        return (
          <li key={`${index}-${reason}`} className="flex items-start gap-2 text-[14px] break-keep">
            <span aria-hidden="true" className={cn('w-4 shrink-0 font-bold', style.className)}>
              {style.mark}
            </span>
            <span className="sr-only">{style.label}: </span>
            <span className="min-w-0 text-text-primary">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      data-icon="external-link"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      className="mt-[3px] shrink-0 text-text-tertiary"
    >
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
