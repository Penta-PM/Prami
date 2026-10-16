/**
 * `pnpm cost-links:dry-run [--target-host <호스트>]` — 원가 매핑 모델명 휴리스틱 dry-run 리포트
 * (스펙 cost-ratio-price-change §2.1-4). READ ONLY 트랜잭션으로 후보·제안을 계산해 **제품군별 개수만** 출력한다
 * (품목명·자재명·원가 없음). 아무것도 저장하지 않는다 — 매핑은 관리자가 `/admin/costs/links` 에서 확정한다.
 */
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const index = args.indexOf('--target-host');
  const targetHost = index >= 0 ? args[index + 1] : undefined;
  const { targetHostViolation, TARGET_HOST_MESSAGES } = await import('../src/lib/db-host');
  const violation = targetHostViolation(process.env, targetHost);
  if (violation) throw new Error(TARGET_HOST_MESSAGES[violation]);
  const [{ createDb }, { withTransaction }, { costAccessForTests }, links, suggest] =
    await Promise.all([
      import('../src/db'),
      import('../src/db/tx'),
      import('../src/server/cost/access-token'),
      import('../src/server/cost/item-links'),
      import('../src/server/cost/item-link-suggest'),
    ]);
  const handle = await createDb();
  try {
    const access = costAccessForTests({ id: null, email: 'cost-links:dry-run' }, 'read');
    const view = await withTransaction((tx) => links.listCostLinkView(access, tx), handle, {
      accessMode: 'read only',
    });
    const rows = suggest.summarizeSuggestions(view.candidates);
    console.log(
      '| 제품군 | 후보 | 정상판매 있음 | 제안 | 제안(정상판매 있음) | S/W 업그레이드 | 모델 못 읽음 | 같은 모델 원가 없음 |',
    );
    console.log('|---|---|---|---|---|---|---|---|');
    for (const row of rows) {
      console.log(
        `| ${row.family} | ${row.candidates} | ${row.withNormalPrice} | ${row.suggested} | ${row.suggestedWithNormalPrice} | ${row.swUpgrade} | ${row.noModel} | ${row.noCost} |`,
      );
    }
    console.log(
      `[cost-links:dry-run] 자재 ${view.materials.length}개 · 확정 링크 ${view.candidates.filter((c) => c.link).length}건 · 고아 ${view.orphans.length}건 (저장 없음)`,
    );
  } finally {
    await handle.close();
  }
}

if (
  process.argv[1] &&
  process.argv[1].replaceAll('\\', '/').endsWith('scripts/cost-links-dry-run.ts')
) {
  main().catch((error: unknown) => {
    console.error('[cost-links:dry-run] 실패:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
