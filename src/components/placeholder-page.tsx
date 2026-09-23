import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';

export type PlaceholderPageProps = {
  title: string;
  description: string;
  /** 실제 화면을 구현하는 PR (스펙 §6) */
  plannedPr: string;
};

/** PR-0 단계의 빈 자리표시자 화면. 셸 안에서 페이지 제목과 예정 PR 만 보여준다 */
export function PlaceholderPage({ title, description, plannedPr }: PlaceholderPageProps) {
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          {title}
        </h1>
        <Pill tone="neutral">{plannedPr} 예정</Pill>
      </div>
      <Card className="flex flex-col gap-2">
        <p className="m-0 text-[14px] text-text-secondary">{description}</p>
        <p className="m-0 text-[12px] text-text-tertiary">
          PR-0 스캐폴드 단계의 자리표시자입니다. 실제 화면은 {plannedPr}에서 구현됩니다.
        </p>
      </Card>
    </section>
  );
}
