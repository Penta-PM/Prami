/**
 * 조달 화면 로딩 상태 (route loading.tsx 공용). 서버 조회(집계·수집 시각)가 끝날 때까지 앱 셸 안에 자리만 잡는다.
 * 모션은 쓰지 않는다(reduced-motion 과 무관하게 정적 자리 표시).
 */
export function ProcurementLoading() {
  return (
    <section aria-busy="true" aria-label="조달 화면 불러오는 중" className="flex flex-col gap-4">
      <div aria-hidden="true" className="h-[25px] w-48 max-w-full rounded-lg bg-gray-100" />
      <div aria-hidden="true" className="h-4 w-72 max-w-full rounded-lg bg-gray-75" />
      <div aria-hidden="true" className="h-48 w-full rounded-2xl bg-gray-75" />
      <p role="status" className="m-0 text-[13px] text-text-tertiary">
        불러오는 중…
      </p>
    </section>
  );
}
