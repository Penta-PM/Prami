import type { DuplicateGroup, DuplicateWarnings } from '@/lib/imports/duplicates';

type DuplicateWarningListsProps = {
  warnings: DuplicateWarnings;
  /** 미리보기(업로드) 인지 적용 결과인지 — 문구만 다르다 */
  stage: 'preview' | 'applied';
  /** 헤더 행 인덱스(0-base). 표시 행 번호를 엑셀 행 번호로 바꾸는 데 쓴다 */
  headerRowIndex: number;
};

/** source_row(데이터 행, 헤더 다음 = 1) → 엑셀 행 번호 (PR-5 QA LOW-1: 미리보기 표·행 오류와 같은 기준) */
export function excelRowOf(sourceRow: number, headerRowIndex: number): number {
  return sourceRow + headerRowIndex + 1;
}

const money = (value: string) => Number(value).toLocaleString('ko-KR');

function groupLabel(group: DuplicateGroup, headerRowIndex: number) {
  const [materialCode] = group.seriesKey.split('|');
  const rows = group.sourceRows.map((row) => excelRowOf(row, headerRowIndex)).join(', ');
  return `${materialCode} · ${group.effectiveFrom} — 엑셀 ${rows}행 (단가 ${group.unitCosts.map(money).join(' / ')})`;
}

/**
 * 원가 같은 날짜 중복 경고 (§4.4.7 r4 3): 전체 그룹을 나열하고, 값이 다른 그룹은 별도 목록(강조)으로 다시 보여 준다.
 * 경고이지 오류가 아니므로 적용은 막지 않는다 — 뒤 행(source_row 큰 행)이 우선한다.
 */
export function DuplicateWarningLists({
  warnings,
  stage,
  headerRowIndex,
}: DuplicateWarningListsProps) {
  const { sameDateDuplicates, conflictingDuplicates } = warnings;
  if (sameDateDuplicates.length === 0) return null;
  const verb = stage === 'preview' ? '적용됩니다' : '적용되었습니다';
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <div
        role="note"
        aria-label="같은 날짜 중복"
        className="rounded-lg bg-surface-card p-3 text-warning-700 shadow-(--hairline-default)"
      >
        <p className="m-0 mb-1 font-semibold">
          같은 계열·적용시작일 중복 {sameDateDuplicates.length}그룹 — 원본 그대로 {verb}(뒤 행 우선,
          앞 행은 적용기간 없음)
        </p>
        <ul className="m-0 list-none p-0">
          {sameDateDuplicates.map((group) => (
            <li key={`${group.seriesKey}|${group.effectiveFrom}`}>
              {groupLabel(group, headerRowIndex)}
            </li>
          ))}
        </ul>
      </div>
      {conflictingDuplicates.length > 0 ? (
        <div
          role="note"
          aria-label="값이 다른 같은 날짜 중복"
          className="rounded-lg bg-warning-50 p-3 text-warning-700 shadow-(--hairline-default)"
        >
          <p className="m-0 mb-1 font-semibold">
            그중 단가가 서로 다른 그룹 {conflictingDuplicates.length}건 — ERP 원본 확인이 필요합니다
          </p>
          <ul className="m-0 list-none p-0">
            {conflictingDuplicates.map((group) => (
              <li key={`${group.seriesKey}|${group.effectiveFrom}`}>
                {groupLabel(group, headerRowIndex)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
