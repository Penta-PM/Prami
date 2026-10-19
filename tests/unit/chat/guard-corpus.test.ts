// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTokenGuard, mentionsCostAmount } from '@/server/chat/graph/guard';
import { mirrorChunks } from '@/server/llm/vendors/fake-chat';

/**
 * 출력 가드 코퍼스 스냅샷 (스펙 output-guard-coverage-2 §2 PR-1 ③): QA corpus7 + 정상 문장 benign2 의 **현재 판정**(R/K)을
 * `guard-corpus.snapshot.json` 으로 고정한다. 이후 PR 의 스냅샷 diff 는 §2 PR-2 허용 규칙(누설 R→K 0, 정상 K→R 0)으로만 바뀐다.
 * 판정을 의도적으로 바꾼 PR 은 `UPDATE_GUARD_SNAPSHOT=1` 로 다시 쓰고 diff 를 PR 본문에 나열한다.
 */
const FIXTURE_DIR = path.resolve(import.meta.dirname, '../../fixtures/chat');
const CORPUS_FILE = path.join(FIXTURE_DIR, 'guard-corpus.json');
const SNAPSHOT_FILE = path.join(FIXTURE_DIR, 'guard-corpus.snapshot.json');

type Row = string | string[];
type Corpus = {
  _source: { file: string; sha256: string; sets: string[] };
  benign2: string[];
} & Record<string, Row[]>;
type Verdict = 'R' | 'K';

const corpus = JSON.parse(readFileSync(CORPUS_FILE, 'utf8')) as Corpus;
const SETS = [...corpus._source.sets, 'benign2'];

/** 행 → 판정할 문장 (spec: [그룹, 문장, 기대], r2: [문장, 종류], 나머지: 문장) */
function sentenceOf(set: string, row: Row): string {
  if (typeof row === 'string') return row;
  return set === 'spec' ? row[1]! : row[0]!;
}

const verdictOf = (sentence: string): Verdict => (mentionsCostAmount(sentence) ? 'R' : 'K');

function currentSnapshot(): Record<string, [Verdict, string][]> {
  return Object.fromEntries(
    SETS.map((set) => [
      set,
      corpus[set]!.map((row) => {
        const sentence = sentenceOf(set, row);
        return [verdictOf(sentence), sentence] as [Verdict, string];
      }),
    ]),
  );
}

/** corpus7.json 원본 직렬화 (Python json.dumps 기본 구분자, ensure_ascii=False) */
function pythonDumps(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonDumps).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${pythonDumps(entry)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}

/** 토큰 가드에 청크를 순서대로 넣고 flush — 내보낸 텍스트와 차단 여부 */
function runTokenGuard(chunks: readonly string[]): { emitted: string; blocked: boolean } {
  const guard = createTokenGuard();
  let emitted = chunks.map((chunk) => guard.push(chunk)).join('');
  emitted += guard.flush();
  return { emitted, blocked: guard.blocked };
}

/** 모든 분할 위치(2청크)·미러 3자 청크에서 토큰 가드 판정 = 문장 전체 판정, R 이면 내보낸 텍스트 0 */
function expectStreamConsistent(sentence: string): void {
  const whole = mentionsCostAmount(sentence);
  const chars = Array.from(sentence);
  const splits = chars
    .slice(1)
    .map((_, index) => [chars.slice(0, index + 1).join(''), chars.slice(index + 1).join('')]);
  for (const chunks of [...splits, mirrorChunks(sentence)]) {
    const { emitted, blocked } = runTokenGuard(chunks);
    expect(blocked, `${sentence} @ ${JSON.stringify(chunks)}`).toBe(whole);
    expect(emitted, `${sentence} @ ${JSON.stringify(chunks)}`).toBe(whole ? '' : sentence);
  }
}

/**
 * 출력 가드 2차 PR-2 (스펙 §4 PR-2) 규칙에 민감한 문장 — 청크 경계가 금액·통화·배수 접미·'엔'/'원가' 뒤 글자 사이에 걸려도
 * 문장이 끝난 뒤 같은 판정을 내리는지. 영문 5k·1.5k 예문은 원가 단어가 있는 문장으로 둔다(규칙은 원가 단어와 같은 문장에서만 쓰임).
 */
const PR2_STREAM_CASES: [string, Verdict][] = [
  ['The cost is 5 million won.', 'R'],
  ['margin 50K USD', 'R'],
  ['cost is 5k won', 'R'],
  ['원가 1.5k USD', 'R'],
  ['원가 1.2M 달러', 'R'],
  ['원가는 3억입니다.', 'R'],
  ['마진은 5천만 정도입니다.', 'R'],
  ['원가는 몇 억 수준입니다.', 'R'],
  ['원가는 500円입니다.', 'R'],
  ['원가는 오천 엔입니다.', 'R'],
  ['원가는 5만엔입니다.', 'R'],
  ['The cost is five million won.', 'R'],
  ['one thousand won cost', 'R'],
  ['cost of five dollars', 'R'],
  ['cost of several million dollars', 'R'],
  ['원가는 1,000 원가량입니다.', 'R'],
  ['원가는 3,000 원가까이 됩니다.', 'R'],
  ['원가는 5,000 엔화입니다.', 'R'],
  ['원가 기준은 2025년입니다.', 'K'],
  ['원가 항목은 3개입니다.', 'K'],
  ['128GB 모델의 원가', 'K'],
  ['4K 모니터 원가는 제공하지 않습니다.', 'K'],
  ['WAPPLES-500 원가', 'K'],
  ['원가 데이터 10만 건', 'K'],
  ['원가 담당 엔지니어 2명이 5 엔진을 봅니다.', 'K'],
  ['원가 계산 API는 3 엔드포인트로 구성됩니다.', 'K'],
  ['원가 시스템은 v2엔 없습니다.', 'K'],
  ['원가 원칙 제3조', 'K'],
  ['원가 사용자 1억 명', 'K'],
  ['원가 검토는 3개만 하면 됩니다.', 'K'],
  ['cost 1,000 wonderful', 'K'],
  ['SA-200 원가는 제공하지 않습니다.', 'K'],
  ['원가 사용자 3천만 명', 'K'],
];

describe('guard-corpus 픽스처', () => {
  it('원본 corpus7 집합이 그대로다 (sha256 일치)', () => {
    const original = Object.fromEntries(corpus._source.sets.map((set) => [set, corpus[set]]));
    const sha = createHash('sha256').update(pythonDumps(original), 'utf8').digest('hex');
    expect(sha).toBe(corpus._source.sha256);
    expect(corpus._source.sha256).toBe(
      '6749a7d1e6ccda063a1875f0260d5a1542ca39a98a0c5848ea056c0b82d7e0c3',
    );
  });

  it('benign2: 원가 단어 + 비금액 숫자 정상 문장 60개 이상, 중복 없음, 모두 K', () => {
    expect(corpus.benign2.length).toBeGreaterThanOrEqual(60);
    expect(new Set(corpus.benign2).size).toBe(corpus.benign2.length);
    expect(corpus.benign2.filter((sentence) => verdictOf(sentence) === 'R')).toEqual([]);
  });
});

describe('main 판정 스냅샷', () => {
  it('집합별 R/K 가 스냅샷과 같다', async () => {
    const current = currentSnapshot();
    if (process.env.UPDATE_GUARD_SNAPSHOT === '1') {
      // 저장소 포맷(prettier)과 같은 모양으로 써서 format:check 와 diff 가 깨끗하게
      const { format, resolveConfig } = await import('prettier');
      const options = { ...(await resolveConfig(SNAPSHOT_FILE)), parser: 'json' };
      writeFileSync(SNAPSHOT_FILE, await format(JSON.stringify(current), options));
    }
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as typeof current;
    expect(Object.keys(snapshot)).toEqual(SETS);
    for (const set of SETS) expect(current[set], set).toEqual(snapshot[set]);
  });

  it('stream: 모든 분할 위치·3자 청크에서 토큰 가드 판정이 문장 전체 판정과 같다 (R 이면 내보낸 텍스트 0)', () => {
    for (const row of corpus.stream!) expectStreamConsistent(sentenceOf('stream', row));
  });

  it('PR-2 규칙 민감 문장(§4 R·K 예문 + 경계): 분할 위치·3자 청크와 무관하게 같은 판정', () => {
    for (const [sentence, verdict] of PR2_STREAM_CASES) {
      expect(verdictOf(sentence), sentence).toBe(verdict);
      expectStreamConsistent(sentence);
    }
  });
});
