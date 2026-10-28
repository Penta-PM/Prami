import type { HTMLAttributes } from 'react';

/**
 * 밀도 규칙 (Penta 디자인 PR-2, Q-D1 = B) — 값은 src/app/globals.css 의 `[data-density]` 블록.
 *
 * - md: 폼·독립 버튼·모달 주요 버튼 — 높이 44(MD) · Body 16
 * - sm: 밀집 컨테이너(표·빠른 필터 바·드로어·관리 목록) — 높이 36(SM) · BodySmall 14
 *
 * 전파는 React context 가 아니라 **CSS 변수 상속**이다: 컨테이너가 `data-density="sm"` 을 달면 그 안의 컨트롤이
 * `--density-control-height`·`--density-font-size` 를 읽는다. 그래서 Button·Input·Select·Table·DensityScope 가
 * 서버 컴포넌트로 남고("use client" 없이), 포털 없이 안에 렌더되는 팝오버도 같이 따르며, 중첩(드로어 안 모달 등)은
 * 가장 가까운 조상이 이긴다. 컨트롤에 `size` 를 주면 컨테이너와 무관하게 그 크기로 고정된다.
 */
export type Density = 'sm' | 'md';

/** 컨트롤 크기 — 'lg'(52) 는 문서 LG, 밀도 규칙 밖의 명시 선택 전용 */
export type ControlSize = Density | 'lg';

/** 밀도 값 (globals.css 와 같은 값 — tests/unit/ui/density.test.tsx 가 대조) */
export const DENSITY_METRICS: Record<Density, { height: number; fontSize: number }> = {
  sm: { height: 36, fontSize: 14 },
  md: { height: 44, fontSize: 16 },
};

/** size 를 주지 않은 컨트롤 — 가장 가까운 [data-density] 를 따른다 (없으면 :root = md) */
export const INHERIT_CONTROL_CLASSES =
  'h-(--density-control-height) text-(length:--density-font-size) leading-(--density-line-height)';

/** size 를 명시한 컨트롤 — 컨테이너 밀도와 무관 */
export const CONTROL_SIZE_CLASSES: Record<ControlSize, string> = {
  sm: 'h-(--height-control-sm) text-[14px] leading-5',
  md: 'h-(--height-control-md) text-[16px] leading-6',
  lg: 'h-(--height-control-lg) text-[16px] leading-6',
};

export function controlSizeClasses(size: ControlSize | undefined): string {
  return size ? CONTROL_SIZE_CLASSES[size] : INHERIT_CONTROL_CLASSES;
}

/** 밀집 컨테이너 표시 — `<div {...densityAttrs('sm')}>` */
export function densityAttrs(density: Density): { 'data-density': Density } {
  return { 'data-density': density };
}

export type DensityScopeProps = HTMLAttributes<HTMLDivElement> & {
  /** 기본 sm — 관리 목록처럼 공용 밀집 컴포넌트(DataTable 등)가 아닌 밀집 영역에 감싼다 */
  density?: Density;
};

/** 밀도 영역 — 안의 공용 컨트롤이 이 밀도를 기본으로 쓴다. 화면별 크기 클래스 대신 이것으로 정한다 */
export function DensityScope({ density = 'sm', ...props }: DensityScopeProps) {
  return <div {...densityAttrs(density)} {...props} />;
}
