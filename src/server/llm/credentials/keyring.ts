import { parseKekList, type KekEntry } from '@/env';

/**
 * KEK 키링 (PRAMI-002 §4.7.1·4.7.2). env `LLM_CREDENTIALS_KEKS`(버전별 32바이트) + `LLM_CREDENTIALS_ACTIVE_KEK`.
 * 새 암호화는 활성 버전, 복호화는 행의 `kek_version`. `KeyProvider` 로 추상화해 KMS 전환 시 구현만 바꾼다.
 * KEK 는 DB 에 없다 — DB 유출만으로는 복호화할 수 없다(T-1).
 */
export type KeyProvider = {
  /** 새 암호화에 쓸 버전 */
  activeVersion: () => number;
  /** 버전의 KEK. 없으면 null (회전 후 옛 버전 제거 → unreadable) */
  kek: (version: number) => Buffer | null;
  versions: () => number[];
};

export class KeyringUnavailableError extends Error {
  constructor() {
    super('LLM 자격 증명 암호화 키(KEK)가 설정되지 않았습니다');
    this.name = 'KeyringUnavailableError';
  }
}

export function createKeyring(entries: readonly KekEntry[], active: number): KeyProvider {
  const byVersion = new Map(entries.map((entry) => [entry.version, Buffer.from(entry.key)]));
  if (!byVersion.has(active)) throw new KeyringUnavailableError();
  return {
    activeVersion: () => active,
    kek: (version) => byVersion.get(version) ?? null,
    versions: () => [...byVersion.keys()].sort((a, b) => a - b),
  };
}

/** env 문자열로 키링을 만든다. 없거나 형식이 틀리면 null (화면은 등록을 비활성화하고 안내 — §4.13) */
export function keyringFromEnv(env: {
  LLM_CREDENTIALS_KEKS?: string;
  LLM_CREDENTIALS_ACTIVE_KEK?: number;
}): KeyProvider | null {
  if (!env.LLM_CREDENTIALS_KEKS || env.LLM_CREDENTIALS_ACTIVE_KEK === undefined) return null;
  const entries = parseKekList(env.LLM_CREDENTIALS_KEKS);
  if (!entries || !entries.some((entry) => entry.version === env.LLM_CREDENTIALS_ACTIVE_KEK)) {
    return null;
  }
  return createKeyring(entries, env.LLM_CREDENTIALS_ACTIVE_KEK);
}
