import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { KeyProvider } from './keyring';

/**
 * 봉투 암호화 (PRAMI-002 §4.7.1, AC-202). AES-256-GCM, `node:crypto` 만 쓴다.
 *   DEK(자격 증명마다 새 32B) 로 비밀값을 seal, KEK(버전) 로 DEK 를 wrap. 둘 다 같은 AAD 에 묶는다.
 *   AAD = "prami:llm-cred:v1|" + credentialId + "|" + userId + "|" + vendor + "|" + authType
 * 행 치환(다른 사용자·벤더·id 로 암호문 이동)은 AAD 불일치로 복호화에 실패한다. DEK 버퍼는 쓰고 바로 0 으로 지운다.
 */
export const ALGORITHM = 'aes-256-gcm';
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const DEK_BYTES = 32;
const AAD_PREFIX = 'prami:llm-cred:v1';

export type AadParts = {
  credentialId: string;
  userId: string;
  vendor: string;
  authType: 'api_key' | 'oauth_pkce';
};

export type SealedSecret = {
  secretCiphertext: Buffer;
  secretIv: Buffer;
  secretTag: Buffer;
  dekWrapped: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  kekVersion: number;
};

/** 복호화 실패(태그 불일치·AAD 불일치·KEK 버전 없음). 원인 상세는 담지 않는다 */
export class CredentialUnreadableError extends Error {
  constructor(readonly reason: 'kek_missing' | 'integrity') {
    super('저장된 자격 증명을 읽을 수 없습니다');
    this.name = 'CredentialUnreadableError';
  }
}

export function buildAad(parts: AadParts): Buffer {
  return Buffer.from(
    [AAD_PREFIX, parts.credentialId, parts.userId, parts.vendor, parts.authType].join('|'),
    'utf8',
  );
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function gcmDecrypt(key: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: Buffer) {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CredentialUnreadableError('integrity');
  }
}

export function sealSecret(secret: string, aad: AadParts, keys: KeyProvider): SealedSecret {
  const version = keys.activeVersion();
  const kek = keys.kek(version);
  if (!kek) throw new CredentialUnreadableError('kek_missing');
  const dek = randomBytes(DEK_BYTES);
  const plaintext = Buffer.from(secret, 'utf8');
  try {
    const additional = buildAad(aad);
    const sealed = gcmEncrypt(dek, plaintext, additional);
    const wrapped = gcmEncrypt(kek, dek, additional);
    return {
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      dekWrapped: wrapped.ciphertext,
      dekIv: wrapped.iv,
      dekTag: wrapped.tag,
      kekVersion: version,
    };
  } finally {
    dek.fill(0);
    plaintext.fill(0);
  }
}

function unwrapDek(sealed: SealedSecret, aad: Buffer, keys: KeyProvider): Buffer {
  const kek = keys.kek(sealed.kekVersion);
  if (!kek) throw new CredentialUnreadableError('kek_missing');
  return gcmDecrypt(kek, sealed.dekWrapped, sealed.dekIv, sealed.dekTag, aad);
}

/** 복호화. 평문은 호출자(service.withDecryptedSecret)의 콜백 안에서만 쓴다 */
export function openSecret(sealed: SealedSecret, aad: AadParts, keys: KeyProvider): string {
  const additional = buildAad(aad);
  const dek = unwrapDek(sealed, additional, keys);
  try {
    const plaintext = gcmDecrypt(
      dek,
      sealed.secretCiphertext,
      sealed.secretIv,
      sealed.secretTag,
      additional,
    );
    const secret = plaintext.toString('utf8');
    plaintext.fill(0);
    return secret;
  } finally {
    dek.fill(0);
  }
}

/** 키 회전(§4.7.2): 비밀값은 그대로 두고 DEK 만 활성 KEK 로 다시 감싼다 */
export function rewrapDek(
  sealed: SealedSecret,
  aad: AadParts,
  keys: KeyProvider,
): Pick<SealedSecret, 'dekWrapped' | 'dekIv' | 'dekTag' | 'kekVersion'> {
  const additional = buildAad(aad);
  const dek = unwrapDek(sealed, additional, keys);
  try {
    const version = keys.activeVersion();
    const kek = keys.kek(version);
    if (!kek) throw new CredentialUnreadableError('kek_missing');
    const wrapped = gcmEncrypt(kek, dek, additional);
    return {
      dekWrapped: wrapped.ciphertext,
      dekIv: wrapped.iv,
      dekTag: wrapped.tag,
      kekVersion: version,
    };
  } finally {
    dek.fill(0);
  }
}
