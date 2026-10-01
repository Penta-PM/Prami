/**
 * `pnpm credentials:rewrap [--yes]` — KEK 회전 (PRAMI-002 §4.7.2). `LLM_CREDENTIALS_KEKS` 에 새 버전을 추가하고
 * `LLM_CREDENTIALS_ACTIVE_KEK` 를 올린 뒤 실행하면, 옛 버전으로 감싼 DEK 를 활성 KEK 로 다시 감싼다.
 * 남은 구버전 행이 0 이면 env 에서 옛 KEK 를 지워도 된다. 키 값은 출력하지 않는다.
 * 원격 DB 에서도 허용(운영 절차)하지만, `--yes` 가 없으면 대상 호스트와 대상 건수만 출력하고 아무것도 바꾸지 않는다 (PRAMI-003 §4.3.4).
 */
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const confirmed = process.argv.slice(2).includes('--yes');
  const [{ createDb }, { parseEnv }, { keyringFromEnv }, { rewrapAll }, { countBelowVersion }] =
    await Promise.all([
      import('../src/db'),
      import('../src/env'),
      import('../src/server/llm/credentials/keyring'),
      import('../src/server/llm/credentials/rewrap'),
      import('../src/server/llm/credentials/repository'),
    ]);
  const { dbHostOf } = await import('../src/lib/db-host');
  const env = parseEnv(process.env);
  const keys = keyringFromEnv(env);
  if (!keys) {
    console.error(
      '[credentials:rewrap] LLM_CREDENTIALS_KEKS / LLM_CREDENTIALS_ACTIVE_KEK 가 설정되지 않았습니다',
    );
    process.exitCode = 1;
    return;
  }
  const handle = await createDb();
  try {
    const target = `${handle.driver}${env.DATABASE_URL ? ` ${dbHostOf(env.DATABASE_URL) ?? '?'}` : ''}`;
    const pending = await countBelowVersion(handle.db, keys.activeVersion());
    console.info(
      `[credentials:rewrap] 대상 ${target} · 활성 v${keys.activeVersion()} · 다시 감쌀 행 ${pending}건`,
    );
    if (!confirmed) {
      console.info('[credentials:rewrap] 확인만 했습니다 (변경 0). 실행하려면 --yes 를 붙이세요');
      return;
    }
    const summary = await rewrapAll(handle, keys);
    console.info(
      `[credentials:rewrap] v${summary.toVersion} 로 ${summary.count}건 다시 감쌈 (이전 버전: ${summary.fromVersions.join(', ') || '없음'}, 읽을 수 없음: ${summary.unreadable}건)`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[credentials:rewrap] 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
