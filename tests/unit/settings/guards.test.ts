// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/env';
import { formatLog, MASK, sanitizeForLog } from '@/server/log';

import { makeFakeKey } from '../../helpers/secret';

/**
 * PRAMI-002 PR-A 정적·환경 가드: env 기동 거부(AC-210·212), 자격 증명 스키마 import 제한(AC-205 ④),
 * 관리자 화면·감사 CSV·사용자 목록에 자격 증명 테이블 없음(AC-205 ⑤), 로그 정리(T-3).
 */
const kek = (fill: string) => Buffer.alloc(32, fill).toString('base64');

describe('env 기동 거부 (AC-210·212)', () => {
  it('KEK: 32바이트가 아니면·활성 버전이 없으면·production 에서 KEK 없으면(CHAT_LLM_ENABLED=true) 거부', () => {
    expect(() =>
      parseEnv({
        LLM_CREDENTIALS_KEKS: `1:${Buffer.alloc(16).toString('base64')}`,
        LLM_CREDENTIALS_ACTIVE_KEK: '1',
      }),
    ).toThrowError(/LLM_CREDENTIALS_KEKS/);
    expect(() => parseEnv({ LLM_CREDENTIALS_KEKS: `1:${kek('a')}` })).toThrowError(
      /LLM_CREDENTIALS_ACTIVE_KEK 가 필요/,
    );
    expect(() =>
      parseEnv({ LLM_CREDENTIALS_KEKS: `1:${kek('a')}`, LLM_CREDENTIALS_ACTIVE_KEK: '2' }),
    ).toThrowError(/버전이 LLM_CREDENTIALS_KEKS 에 없습니다/);
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrowError(
      /CHAT_LLM_ENABLED=true 이면 LLM_CREDENTIALS_KEKS/,
    );
    expect(parseEnv({ NODE_ENV: 'production', CHAT_LLM_ENABLED: 'false' }).CHAT_LLM_ENABLED).toBe(
      false,
    );
    const ok = parseEnv({
      LLM_CREDENTIALS_KEKS: `1:${kek('a')},2:${kek('b')}`,
      LLM_CREDENTIALS_ACTIVE_KEK: '2',
    });
    expect(ok.LLM_CREDENTIALS_ACTIVE_KEK).toBe(2);
    // 개발에서 KEK 없음은 허용 (화면이 등록을 막고 안내)
    expect(parseEnv({}).LLM_CREDENTIALS_KEKS).toBeUndefined();
  });

  it('production 또는 VERCEL_ENV 에서 LLM_VENDOR_MODE=fake·LANGSMITH_TRACING=true 면 거부, 로컬은 허용', () => {
    const prod = { NODE_ENV: 'production', CHAT_LLM_ENABLED: 'false' };
    expect(() => parseEnv({ ...prod, LLM_VENDOR_MODE: 'fake' })).toThrowError(
      /LLM_VENDOR_MODE=fake/,
    );
    expect(() => parseEnv({ VERCEL_ENV: 'preview', LLM_VENDOR_MODE: 'fake' })).toThrowError(
      /LLM_VENDOR_MODE=fake/,
    );
    expect(() => parseEnv({ ...prod, LANGSMITH_TRACING: 'true' })).toThrowError(
      /LANGSMITH_TRACING/,
    );
    expect(() => parseEnv({ VERCEL_ENV: 'production', LANGCHAIN_TRACING_V2: '1' })).toThrowError(
      /LANGCHAIN_TRACING_V2/,
    );
    expect(parseEnv({ LLM_VENDOR_MODE: 'fake', LANGSMITH_TRACING: 'true' }).LLM_VENDOR_MODE).toBe(
      'fake',
    );
    expect(parseEnv({}).LLM_VENDOR_MODE).toBe('live');
    expect(parseEnv({}).LLM_VERIFY_PER_MIN).toBe(5);
    expect(() => parseEnv({ LLM_VENDOR_MODE: 'mock' })).toThrowError(/LLM_VENDOR_MODE/);
  });
});

describe('자격 증명 스키마 import 제한 (AC-205 ④)', () => {
  it('server/llm/credentials 밖에서 userLlmCredentials·schema/llm-credentials 를 import 하면 lint 실패, 안에서는 통과', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const leak =
      "import { userLlmCredentials } from '@/db/schema';\nexport const x = userLlmCredentials;\n";
    const leakPath =
      "import { userLlmCredentials } from '@/db/schema/llm-credentials';\nexport const x = userLlmCredentials;\n";
    const [outside] = await eslint.lintText(leak, {
      filePath: 'src/features/settings/zz-injected.ts',
    });
    expect(outside!.messages.map((message) => message.ruleId)).toContain('no-restricted-imports');
    const [byPath] = await eslint.lintText(leakPath, {
      filePath: 'src/server/chat/zz-injected.ts',
    });
    expect(byPath!.messages.map((message) => message.ruleId)).toContain('no-restricted-imports');
    const [inCost] = await eslint.lintText(leak, { filePath: 'src/features/costs/zz-injected.ts' });
    expect(inCost!.messages.map((message) => message.ruleId)).toContain('no-restricted-imports');
    const [inside] = await eslint.lintText(leak, {
      filePath: 'src/server/llm/credentials/zz-injected.ts',
    });
    expect(
      inside!.messages.filter((message) => message.ruleId === 'no-restricted-imports'),
    ).toEqual([]);
  }, 60_000);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('관리자·감사 CSV·사용자 목록에 자격 증명 테이블 없음 (AC-205 ⑤)', () => {
  it('user_llm_credentials / userLlmCredentials 참조는 스키마·마이그레이션·credentials 모듈에만 있다', () => {
    const allowed = [
      path.join('src', 'db', 'schema'),
      path.join('src', 'server', 'llm', 'credentials'),
    ];
    const offenders = walk('src')
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)))
      .filter((file) => /user_llm_credentials|userLlmCredentials/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
    // 사용자 관리·감사 화면/쿼리·CSV 파일도 LLM 연결 여부를 다루지 않는다 (감사 action 이름 상수 파일만 예외)
    const auditActionNames = path.join('src', 'server', 'audit', 'log.ts');
    const adminFiles = walk('src').filter(
      (file) =>
        /admin|audit|users/.test(file) && /\.(ts|tsx)$/.test(file) && file !== auditActionNames,
    );
    expect(adminFiles.length).toBeGreaterThan(0);
    for (const file of adminFiles) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/llm_credential|LlmCredential|keyHint/);
    }
  });
});

describe('로그 정리 (T-3)', () => {
  it('벤더 키 형식은 값 속에서도 [REDACTED], 키 이름(apiKey·secret·x-goog-api-key)은 통째로', () => {
    const key = makeFakeKey('fake-echo-');
    expect(sanitizeForLog(`Incorrect API key provided: ${key}`)).toBe(
      `Incorrect API key provided: ${MASK}`,
    );
    expect(sanitizeForLog(`bad sk-ant-${'Ab1'.repeat(10)} end`)).toBe(`bad ${MASK} end`);
    expect(sanitizeForLog(`AIza${'Q9'.repeat(18)}`)).toBe(MASK);
    const record = formatLog('error', 'llm.verify_failed', {
      apiKey: key,
      headers: { 'x-goog-api-key': key, 'x-api-key': key },
      error: new Error(`Incorrect API key provided: ${key}`),
    });
    expect(JSON.stringify(record)).not.toContain(key.slice(-12));
  });
});
