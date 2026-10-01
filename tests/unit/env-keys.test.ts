import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ENV_SCHEMA_KEYS } from '@/env';

/**
 * AC-322 env 정합: `src/env.ts` 스키마 키 = docs/deploy/vercel.md §2 표(PRAMI-003 §4.3.2) = `.env.example` 키.
 * 하나를 빼거나 더하면 실패한다. `.env.example` 에는 값이 없어야 한다.
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** Node·Vercel 이 주입하는 키 — .env.example 에 두지 않는다 */
const INJECTED = new Set(['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA']);

function docTableKeys(markdown: string): string[] {
  const start = markdown.indexOf('<!-- env-table:start -->');
  const end = markdown.indexOf('<!-- env-table:end -->');
  if (start < 0 || end < start) throw new Error('env-table 표식이 없습니다');
  return markdown
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| `'))
    .flatMap((line) => [...line.split('|')[1]!.matchAll(/`([A-Z0-9_]+)`/g)].map((m) => m[1]!));
}

function envExampleEntries(text: string): Array<[key: string, value: string]> {
  return text
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    });
}

const sorted = (keys: Iterable<string>) => [...new Set(keys)].sort();

describe('env 키 정합 (AC-322)', () => {
  const schema = sorted(ENV_SCHEMA_KEYS);
  const doc = sorted(docTableKeys(read('docs/deploy/vercel.md')));
  const example = envExampleEntries(read('.env.example'));

  it('vercel.md §2 표 = 스키마 (NODE_ENV 제외)', () => {
    expect(doc).toEqual(schema.filter((key) => key !== 'NODE_ENV'));
  });

  it('.env.example = 스키마 (주입 키 제외), 중복 없음', () => {
    const keys = example.map(([key]) => key);
    expect(keys.length).toBe(new Set(keys).size);
    expect(sorted(keys)).toEqual(schema.filter((key) => !INJECTED.has(key)));
  });

  it('.env.example 에는 값이 없다', () => {
    expect(example.filter(([, value]) => value.trim() !== '')).toEqual([]);
  });

  it('표에서 키 하나를 빼면 불일치가 드러난다 (검사기 자체 확인)', () => {
    const markdown = read('docs/deploy/vercel.md').replace(/\| `MAINTENANCE_MODE` .*\n/, '');
    expect(sorted(docTableKeys(markdown))).not.toEqual(doc);
    expect(() => docTableKeys('표 없음')).toThrowError(/env-table/);
  });
});
