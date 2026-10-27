import type { MarkerShape } from './palette';

/** 계열 표식 (색 외 구분) — (x, y) 중심, r = 반지름. 테두리는 카드 배경색으로 둘러 막대·선 위에서도 읽힌다 */
export function Marker({
  shape,
  x,
  y,
  r = 4,
  color,
}: {
  shape: MarkerShape;
  x: number;
  y: number;
  r?: number;
  color: string;
}) {
  const common = {
    fill: color,
    stroke: 'var(--surface-card)',
    strokeWidth: 1.5,
    'data-marker': shape,
  } as const;
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={r} {...common} />;
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
    case 'triangle':
      return (
        <path
          d={`M${x},${y - r * 1.2}L${x + r * 1.1},${y + r}L${x - r * 1.1},${y + r}Z`}
          {...common}
        />
      );
    case 'triangle-down':
      return (
        <path
          d={`M${x},${y + r * 1.2}L${x + r * 1.1},${y - r}L${x - r * 1.1},${y - r}Z`}
          {...common}
        />
      );
    case 'diamond':
      return (
        <path
          d={`M${x},${y - r * 1.3}L${x + r * 1.3},${y}L${x},${y + r * 1.3}L${x - r * 1.3},${y}Z`}
          {...common}
        />
      );
    case 'cross': {
      const a = r * 1.2;
      const b = r * 0.45;
      return (
        <path
          d={`M${x - b},${y - a}H${x + b}V${y - b}H${x + a}V${y + b}H${x + b}V${y + a}H${x - b}V${y + b}H${x - a}V${y - b}H${x - b}Z`}
          {...common}
        />
      );
    }
  }
}

/** 범례·툴팁용 작은 표식 (14px 인라인 svg) */
export function MarkerSwatch({ shape, color }: { shape: MarkerShape; color: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      <Marker shape={shape} x={7} y={7} r={4.5} color={color} />
    </svg>
  );
}
