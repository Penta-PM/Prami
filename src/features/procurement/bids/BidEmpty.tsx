import { Card } from '@/components/ui';
import { DEFAULT_BID_FILTER, type BidFilter } from '@/lib/procurement/bid-filter';

/**
 * 입찰 공고 빈 상태 — 수집된 공고 자체가 없을 때(새 설치·E2E)와 조건에 맞는 공고가 없을 때를 구분한다.
 * 진행 중만 보고 있으면 "마감 포함" 으로 넓혀 보라는 안내를 붙인다.
 */
export function BidEmpty({ filter, allCount }: { filter: BidFilter; allCount: number }) {
  const unfiltered =
    filter.product === DEFAULT_BID_FILTER.product &&
    filter.topGradeOnly === DEFAULT_BID_FILTER.topGradeOnly &&
    allCount === 0;
  const title = !unfiltered
    ? '조건에 맞는 입찰 공고가 없습니다'
    : filter.includeClosed
      ? '수집된 입찰 공고가 없습니다'
      : '진행 중인 입찰 공고가 없습니다';
  const hints: string[] = [];
  if (!filter.includeClosed) hints.push('“마감 포함”을 고르면 마감된 공고도 함께 봅니다.');
  if (filter.topGradeOnly) hints.push('“상만”을 끄면 적합도 중·하 공고도 봅니다.');
  if (filter.product) hints.push('“전체” 칩을 고르면 모든 제품의 공고를 봅니다.');

  return (
    <Card
      role="status"
      data-testid="bid-empty"
      className="flex flex-col items-center gap-2 py-12 text-center"
    >
      <p className="m-0 text-[16px] font-semibold text-text-primary">{title}</p>
      {hints.map((hint) => (
        <p key={hint} className="m-0 text-[14px] break-keep text-text-tertiary">
          {hint}
        </p>
      ))}
    </Card>
  );
}
