import { InfoHint } from '@/components/ui';
import { ERP_GUIDE_INTRO, ERP_GUIDE_STEPS, ERP_GUIDE_TITLE } from '@/lib/constants/erp-guide';

/**
 * ERP 업로드 공통 설명 (스펙 erp-upload-guide §2-3·§6.1). 업로드 패널(ImportPanel·CostImportPanel) 맨 위에 둔다.
 *
 * - Q-E1(사용자 지정): 상시 박스가 아니라 "PRAMI ERP 데이터" 버튼(ⓘ + 글자) → 누르면 공통 설명 팝오버. 닫힘은 InfoHint 공통.
 * - Q-E2: 두 줄(조회 안내 1줄 + 단계 1줄).
 * - 단계는 순서 목록(<ol>) — 순서는 목록 의미로 전달하고, 화면의 → 는 장식(aria-hidden).
 * - "[EXCEL로 전송하기]" 는 대괄호를 유지하고 굵게.
 */
export function ErpDataGuide() {
  return (
    <div className="flex">
      <InfoHint name={ERP_GUIDE_TITLE} text={ERP_GUIDE_TITLE} className="-ml-2">
        <span className="block">{ERP_GUIDE_INTRO}</span>{' '}
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-1.5 p-0">
          {ERP_GUIDE_STEPS.map((step, index) => (
            <li key={index} className="inline-flex items-center gap-1.5">
              {/* 낭독 시 단계 사이 띄어 읽기 — flex 안 공백 텍스트는 화면에 그리지 않는다 */}
              {index > 0 ? ' ' : null}
              {index > 0 ? <span aria-hidden="true">→</span> : null}
              <span>
                {step.strong ? (
                  <strong className="font-semibold text-ink-900">{step.strong}</strong>
                ) : null}
                {step.text}
              </span>
            </li>
          ))}
        </ol>
      </InfoHint>
    </div>
  );
}
