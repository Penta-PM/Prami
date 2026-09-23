/** INSERT/UPDATE ... RETURNING 처럼 정확히 1행이 기대되는 결과에서 첫 행을 꺼낸다 */
export function firstRow<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what}: 결과 행이 없습니다`);
  return row;
}
