// @vitest-environment node
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * AC-225 import 그래프 (PRAMI-002 §4.4.1): server/chat·server/llm·app/api/chat·features/chat 에서 시작한 **전이적** import 가
 * `server/cost`·`schema/material-costs` 에 닿지 않음을 TS 모듈 해석으로 확인한다. 동적 import 는 ESLint 가 리터럴만 허용한다.
 * `@/db/schema` 배럴(index.ts)은 모든 테이블을 재수출하므로 따라가지 않는다 — 배럴에서 materialCosts 를 **이름으로** 가져오는 것은
 * ESLint(no-restricted-imports, AC-42)가 막는다. 위반 파일을 주입하면 이 검사가 실패해야 한다.
 */
const ROOT = process.cwd();
const ENTRY_DIRS = ['src/server/chat', 'src/server/llm', 'src/app/api/chat', 'src/features/chat'];
const FORBIDDEN = /src[\\/](server[\\/]cost[\\/]|db[\\/]schema[\\/]material-costs)/;
const BARREL = path.join(ROOT, 'src/db/schema/index.ts');
const PROBE = path.join(ROOT, 'src/server/chat/features/__cost_probe.tmp.ts');

const config = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT).options;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  return info.importedFiles
    .map((entry) => ts.resolveModuleName(entry.fileName, file, options, ts.sys).resolvedModule)
    .filter((resolved): resolved is ts.ResolvedModuleFull => Boolean(resolved))
    .filter((resolved) => !resolved.isExternalLibraryImport)
    .map((resolved) => path.resolve(resolved.resolvedFileName))
    .filter((resolved) => resolved.startsWith(ROOT) && !resolved.includes('node_modules'));
}

/** 진입점에서 닿는 모든 로컬 모듈 (배럴에서 멈춤) */
function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries.map((entry) => path.resolve(entry))];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file === BARREL || !existsSync(file)) continue;
    stack.push(...importsOf(file));
  }
  return seen;
}

const entries = () => ENTRY_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

afterAll(() => {
  rmSync(PROBE, { force: true });
});

describe('원가 import 그래프 (AC-225)', () => {
  it('챗봇·LLM·패널 진입점의 전이적 import 가 server/cost·schema/material-costs 에 닿지 않는다', () => {
    const reached = [...reachable(entries())];
    expect(reached.length).toBeGreaterThan(40);
    expect(reached.filter((file) => FORBIDDEN.test(file))).toEqual([]);
    // 실제로 깊게 따라갔는지: 규칙 엔진·판매단가 쿼리·자격 증명 서비스에 닿는다
    const relative = reached.map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
    expect(relative).toEqual(
      expect.arrayContaining([
        'src/server/chat/respond.ts',
        'src/server/chat/queries.ts',
        'src/server/llm/credentials/service.ts',
      ]),
    );
  });

  it('위반 파일(도구에서 server/cost import)을 주입하면 검사가 실패한다', () => {
    writeFileSync(
      PROBE,
      "import { listMaterialCosts } from '@/server/cost/queries';\nexport const probe = listMaterialCosts;\n",
    );
    try {
      const reached = [...reachable([...entries(), PROBE])];
      expect(reached.filter((file) => FORBIDDEN.test(file)).length).toBeGreaterThan(0);
    } finally {
      rmSync(PROBE, { force: true });
    }
  });
});
