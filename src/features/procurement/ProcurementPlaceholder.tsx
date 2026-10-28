import { Card } from '@/components/ui';

/**
 * 아직 내용이 없는 조달 화면의 빈 라우트 (UI-1 셸). 조회 화면은 UI-2·3·5, 관리 탭은 단계 3(UI-6~8)이 채운다.
 * 쓰기·조회 동작은 없다.
 */
export function ProcurementPlaceholder({
  title = '화면 준비 중',
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <Card role="status" className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="m-0 text-[16px] font-semibold text-text-primary">{title}</p>
      <p className="m-0 text-[14px] break-keep text-text-tertiary">{description}</p>
    </Card>
  );
}
