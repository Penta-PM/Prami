/**
 * 조달 차트 색·표식 (조달이 통합 UI-4 → Penta 차트 PR-5). 매핑만 여기서 정한다 — 렌더링(#88)은 차트 컴포넌트.
 *   자사 = `--accent-ours`(Primary 600) · 경쟁사 순위 1~4 = `--chart-series-1..4` · 나머지 = Neutral 600 · 최근 연도 선 = Neutral 900
 * 모든 계열 색은 차트 배경(흰색 `--surface-card`, hover 띠 N50) 위 그래픽 대비 3:1 이상 — tokens.test.ts 가 검사한다.
 * 경쟁사끼리·자사와의 명도 대비 3:1 은 (모두 흰색 3:1 이어야 해서) 불가능하므로 색상(hue)을 달리하고,
 * 색만으로 구분하지 않도록 계열마다 **표식 모양**(원·사각·삼각·마름모·역삼각·십자)을 달리하며 범례·툴팁·표에 이름을 함께 쓴다.
 */

/** 자사 강조 토큰 이름 (= Primary 600) */
export const OURS_TOKEN = '--accent-ours';

/** 경쟁사(또는 과거 연도) 계열 색 토큰 — 순위 순서. 이 수를 넘는 계열은 OTHER_TOKEN. 값·근거는 globals.css */
export const SERIES_TOKENS = [
  '--chart-series-1',
  '--chart-series-2',
  '--chart-series-3',
  '--chart-series-4',
] as const;

/** 하위 계열(나머지) 회색 = Neutral 600 */
export const OTHER_TOKEN = '--penta-neutral-600';

/** 가장 최근 연도 선(연도별 선 차트) — 자사 강조와 섞이지 않게 중립 진한 색 = Neutral 900 */
export const LATEST_YEAR_TOKEN = '--penta-neutral-900';

/** 대비 검사 대상(그래픽 3:1) — tokens.test.ts */
export const CHART_GRAPHIC_TOKENS = [
  OURS_TOKEN,
  ...SERIES_TOKENS,
  OTHER_TOKEN,
  LATEST_YEAR_TOKEN,
] as const;

const cssVar = (token: string) => `var(${token})`;

/** 계열 색 — 자사면 --accent-ours, 아니면 경쟁사 순번(rank 0부터)의 --chart-series-*, 넘치면 Neutral 600 */
export function seriesColor(rank: number, isOurs = false): string {
  if (isOurs) return cssVar(OURS_TOKEN);
  return cssVar(SERIES_TOKENS[rank] ?? OTHER_TOKEN);
}

export const MARKER_SHAPES = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'triangle-down',
  'cross',
] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

/** 계열 표식 — 자사는 항상 원, 나머지는 순번대로 (원 제외) */
export function seriesMarker(rank: number, isOurs = false): MarkerShape {
  if (isOurs) return 'circle';
  return MARKER_SHAPES[1 + (rank % (MARKER_SHAPES.length - 1))]!;
}
