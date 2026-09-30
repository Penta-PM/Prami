/**
 * `pnpm credentials:rewrap` — KEK 회전 (PRAMI-002 §4.7.2). `LLM_CREDENTIALS_KEKS` 에 새 버전을 추가하고
 * `LLM_CREDENTIALS_ACTIVE_KEK` 를 올린 뒤 실행하면, 옛 버전으로 감싼 DEK 를 활성 KEK 로 다시 감싼다.
 * 남은 구버전 행이 0 이면 env 에서 옛 KEK 를 지워도 된다. 키 값은 출력하지 않는다.
 */
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const [{ createDb }, { parseEnv }, { keyringFromEnv }, { rewrapAll }] = await Promise.all([
    import('../src/db'),
    import('../src/env'),
    import('../src/server/llm/credentials/keyring'),
    import('../src/server/llm/credentials/rewrap'),
  ]);
  const keys = keyringFromEnv(parseEnv(process.env));
  if (!keys) {
    console.error(
      '[credentials:rewrap] LLM_CREDENTIALS_KEKS / LLM_CREDENTIALS_ACTIVE_KEK 가 설정되지 않았습니다',
    );
    process.exit(1);
  }
  const handle = await createDb();
  try {
    const summary = await rewrapAll(handle, keys);
    console.info(
      `[credentials:rewrap] v${summary.toVersion} 로 ${summary.count}건 다시 감쌈 (이전 버전: ${summary.fromVersions.join(', ') || '없음'}, 읽을 수 없음: ${summary.unreadable}건)`,
    );
  } finally {
    await handle.close();
  }
}

void main();
