import 'server-only';

import type { DbHandle } from '@/db';
import { withTransaction } from '@/db/tx';
import { AUDIT_ACTIONS, writeAudit } from '@/server/audit/log';

import { CredentialUnreadableError, rewrapDek } from './crypto';
import type { KeyProvider } from './keyring';
import { listBelowVersion, updateWrap } from './repository';

/**
 * KEK 회전 rewrap (PRAMI-002 §4.7.2, AC-210). 활성 버전보다 낮은 행의 **DEK 만** 풀어 활성 KEK 로 다시 감싼다
 * (비밀값 재암호화 없음, 행 단위 트랜잭션). 옛 KEK 가 이미 없는 행은 건너뛰고 unreadable 로 센다.
 * 결과 요약만 감사 `system.kek_rewrap`(건수·버전, actor=system)으로 남긴다.
 */
export type RewrapSummary = {
  toVersion: number;
  fromVersions: number[];
  count: number;
  unreadable: number;
};

export const REWRAP_BATCH = 100;

export async function rewrapAll(
  handle: DbHandle,
  keys: KeyProvider,
  batch: number = REWRAP_BATCH,
): Promise<RewrapSummary> {
  const toVersion = keys.activeVersion();
  const fromVersions = new Set<number>();
  const skipped = new Set<string>();
  let count = 0;
  for (;;) {
    const rows = (await listBelowVersion(handle.db, toVersion, batch + skipped.size)).filter(
      (row) => !skipped.has(row.id),
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const aad = {
        credentialId: row.id,
        userId: row.userId,
        vendor: row.vendor,
        authType: row.authType,
      };
      try {
        const wrap = rewrapDek(row, aad, keys);
        await withTransaction((tx) => updateWrap(tx, row.id, wrap), handle);
        fromVersions.add(row.kekVersion);
        count += 1;
      } catch (error) {
        if (!(error instanceof CredentialUnreadableError)) throw error;
        skipped.add(row.id);
      }
    }
  }
  const summary = {
    toVersion,
    fromVersions: [...fromVersions].sort((a, b) => a - b),
    count,
    unreadable: skipped.size,
  };
  await writeAudit(handle.db, {
    actor: { id: null, label: 'system' },
    action: AUDIT_ACTIONS.kekRewrap,
    target: { type: 'kek', id: String(toVersion), label: `v${toVersion}` },
    after: summary,
  });
  return summary;
}
