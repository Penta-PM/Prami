// @vitest-environment node
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseKekList } from '@/env';
import {
  buildAad,
  CredentialUnreadableError,
  DEK_BYTES,
  IV_BYTES,
  openSecret,
  rewrapDek,
  sealSecret,
  TAG_BYTES,
  type SealedSecret,
} from '@/server/llm/credentials/crypto';
import { createKeyring, keyringFromEnv } from '@/server/llm/credentials/keyring';

import { makeFakeKey } from '../../helpers/secret';

/** AC-202 봉투 암호화 · AC-210 키링/회전 (단위) */
const v1 = { version: 1, key: randomBytes(32) };
const v2 = { version: 2, key: randomBytes(32) };
const keysV1 = createKeyring([v1], 1);
const aad = {
  credentialId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  vendor: 'anthropic',
  authType: 'api_key' as const,
};

const FIELDS = [
  'secretCiphertext',
  'secretIv',
  'secretTag',
  'dekWrapped',
  'dekIv',
  'dekTag',
] as const;

function flip(sealed: SealedSecret, field: (typeof FIELDS)[number]): SealedSecret {
  const copy = Buffer.from(sealed[field]);
  copy[0] = copy[0]! ^ 0xff;
  return { ...sealed, [field]: copy };
}

describe('sealSecret / openSecret (AC-202)', () => {
  it('① 라운드트립 ⑤ IV 12B·태그 16B·DEK 32B (감싼 DEK 도 32B)', () => {
    const secret = makeFakeKey();
    const sealed = sealSecret(secret, aad, keysV1);
    expect(openSecret(sealed, aad, keysV1)).toBe(secret);
    expect(sealed.secretIv).toHaveLength(IV_BYTES);
    expect(sealed.dekIv).toHaveLength(IV_BYTES);
    expect(sealed.secretTag).toHaveLength(TAG_BYTES);
    expect(sealed.dekTag).toHaveLength(TAG_BYTES);
    expect(sealed.dekWrapped).toHaveLength(DEK_BYTES);
    expect(sealed.kekVersion).toBe(1);
    expect(sealed.secretCiphertext.toString('utf8')).not.toContain(secret.slice(-12));
  });

  it('② 같은 키를 두 번 암호화하면 암호문·IV·감싼 DEK 가 모두 다르다', () => {
    const secret = makeFakeKey();
    const a = sealSecret(secret, aad, keysV1);
    const b = sealSecret(secret, aad, keysV1);
    expect(a.secretCiphertext.equals(b.secretCiphertext)).toBe(false);
    expect(a.secretIv.equals(b.secretIv)).toBe(false);
    expect(a.dekWrapped.equals(b.dekWrapped)).toBe(false);
  });

  it.each(FIELDS)('③ %s 한 바이트 변조 → 복호화 예외', (field) => {
    const sealed = sealSecret(makeFakeKey(), aad, keysV1);
    expect(() => openSecret(flip(sealed, field), aad, keysV1)).toThrow(CredentialUnreadableError);
  });

  it.each(['userId', 'vendor', 'credentialId'] as const)(
    '④ AAD 의 %s 가 바뀌면(다른 행으로 이동) 예외',
    (part) => {
      const sealed = sealSecret(makeFakeKey(), aad, keysV1);
      const moved = {
        ...aad,
        [part]: part === 'vendor' ? 'openai' : '33333333-3333-4333-8333-333333333333',
      };
      expect(() => openSecret(sealed, moved, keysV1)).toThrow(CredentialUnreadableError);
    },
  );

  it('AAD 는 "prami:llm-cred:v1|id|user|vendor|authType"', () => {
    expect(buildAad(aad).toString('utf8')).toBe(
      `prami:llm-cred:v1|${aad.credentialId}|${aad.userId}|anthropic|api_key`,
    );
  });
});

describe('키링·회전 (AC-210 단위)', () => {
  it('새 암호화는 활성 버전, 복호화는 행 버전 — v1 행을 v2 활성 키링으로도 연다', () => {
    const secret = makeFakeKey();
    const oldRow = sealSecret(secret, aad, keysV1);
    const keysV2 = createKeyring([v1, v2], 2);
    expect(sealSecret(secret, aad, keysV2).kekVersion).toBe(2);
    expect(openSecret(oldRow, aad, keysV2)).toBe(secret);
  });

  it('rewrapDek: DEK 만 v2 로 다시 감싸고 비밀값 암호문은 그대로, 이후 v1 없이도 열린다', () => {
    const secret = makeFakeKey();
    const oldRow = sealSecret(secret, aad, keysV1);
    const keysV2 = createKeyring([v1, v2], 2);
    const wrap = rewrapDek(oldRow, aad, keysV2);
    expect(wrap.kekVersion).toBe(2);
    const rewrapped = { ...oldRow, ...wrap };
    expect(rewrapped.secretCiphertext.equals(oldRow.secretCiphertext)).toBe(true);
    expect(openSecret(rewrapped, aad, createKeyring([v2], 2))).toBe(secret);
  });

  it('행의 KEK 버전이 키링에 없으면 kek_missing (재등록 필요)', () => {
    const oldRow = sealSecret(makeFakeKey(), aad, keysV1);
    const error = (() => {
      try {
        openSecret(oldRow, aad, createKeyring([v2], 2));
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(CredentialUnreadableError);
    expect((error as CredentialUnreadableError).reason).toBe('kek_missing');
  });

  it('parseKekList: 32바이트·버전 중복·형식 검사, keyringFromEnv 는 없거나 틀리면 null', () => {
    const b64 = (buffer: Buffer) => buffer.toString('base64');
    expect(
      parseKekList(`1:${b64(v1.key)}, 2:${b64(v2.key)}`)?.map((entry) => entry.version),
    ).toEqual([1, 2]);
    expect(parseKekList(`1:${b64(randomBytes(16))}`)).toBeNull();
    expect(parseKekList(`1:${b64(v1.key)},1:${b64(v2.key)}`)).toBeNull();
    expect(parseKekList('nope')).toBeNull();
    expect(keyringFromEnv({})).toBeNull();
    expect(
      keyringFromEnv({ LLM_CREDENTIALS_KEKS: `1:${b64(v1.key)}`, LLM_CREDENTIALS_ACTIVE_KEK: 2 }),
    ).toBeNull();
    expect(
      keyringFromEnv({
        LLM_CREDENTIALS_KEKS: `1:${b64(v1.key)}`,
        LLM_CREDENTIALS_ACTIVE_KEK: 1,
      })?.versions(),
    ).toEqual([1]);
    expect(() => createKeyring([v1], 3)).toThrow();
  });
});
