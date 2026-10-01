/**
 * 저장소 비밀값 검사 (§4.8, AC-96). CI 잡 `secrets` 가 `pnpm check:secrets` 로 실행한다.
 * `git ls-files` 로 추적 중인 텍스트 파일만 보고, 아래 패턴이 하나라도 있으면 파일:줄과 함께 실패(exit 1)한다.
 * - 자격 증명이 든 postgres URL (호스트가 localhost·127.0.0.1·CI 서비스가 아니고, 비밀번호가 pw·password 같은 가짜 값이 아닌 것)
 * - `AUTH_SECRET` / `AUTH_GOOGLE_SECRET` 에 실제 값이 대입된 줄 — `=`·`:`(YAML/JSON/TS)·소문자 키 모두
 *   (빈 값·`$(...)`·`${{ secrets.X }}`·`<...>` 자리표시자, e2e/test/example 표식이 든 테스트 전용 값은 허용)
 * - Google OAuth 클라이언트 시크릿(`GOCSPX-…`)·클라이언트 ID(`…apps.googleusercontent.com`)
 * - Neon 비밀번호 접두사(`npg_…`)
 * - LLM 벤더 키(Anthropic `sk-ant-`, OpenAI `sk-`/`sk-proj-`, Google `AIza`, OpenRouter `sk-or-`)·`LLM_CREDENTIALS_KEKS` 실제 값 (PRAMI-002 §4.7.5)
 * 로컬 docker-compose 기본값(`prami:prami@localhost`)과 테스트 전용 고정값은 로컬 개발용이라 허용한다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type SecretFinding = { file: string; line: number; rule: string; excerpt: string };

type Rule = { name: string; test: (line: string, file: string) => boolean };

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres', 'db', '0.0.0.0']);
const PG_URL_RE = /postgres(?:ql)?:\/\/([^\s:@/'"`]+):([^\s@/'"`]+)@([^\s/:'"`]+)/gi;
/** 테스트 픽스처의 누가 봐도 가짜인 비밀번호 (예: `user:pw@ep-test.neon.tech`) */
const DUMMY_PASSWORDS = new Set([
  'pw',
  'pass',
  'password',
  'secret',
  'x',
  'xxx',
  'changeme',
  'test',
]);
const PLACEHOLDER_RE = /^(\$|<|\{|…|\.\.\.)/;

/**
 * 테스트·예시 전용이 명백한 값 (예: CI·Playwright 의 `e2e-only-secret-not-for-production-…`).
 * 운영 비밀값은 이런 표식을 넣어 만들지 않는다는 전제 — 걸리면 값을 바꾸고 이 목록은 늘리지 않는다.
 */
const TEST_VALUE_RE = /(e2e|test|example|dummy|placeholder|not-for-production|changeme|your[-_])/i;

/** 코드 파일에서는 따옴표 없는 값이 식별자·식(`optionalString`, `z.string()`)이라 비밀값으로 보지 않는다 */
const CODE_FILE_RE = /\.(m?[jt]sx?|cjs)$/i;

/** 비밀값처럼 보이는 값: 숫자와 문자가 섞였거나 24자 이상 (예: `client-secret` 같은 단어 조합은 제외) */
function looksRandom(value: string): boolean {
  return (/\d/.test(value) && /[A-Za-z]/.test(value)) || value.length >= 24;
}

/**
 * `KEY=value`(env·셸), `KEY: value`(YAML·JSON·TS 객체), `"KEY": "value"`, 소문자 키까지 잡는다 (PR-11a QA L-2).
 * 키 앞뒤 따옴표 허용, 대소문자 무시.
 */
function assignment(key: string): Rule {
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9_])['"]?${key}['"]?\\s*[:=]\\s*(['"\`]?)([^\\s'"\`#,;]+)`,
    'i',
  );
  return {
    name: `${key} 값 대입`,
    test: (line, file) => {
      const match = re.exec(line);
      const quote = match?.[1] ?? '';
      const value = match?.[2];
      if (!value || value.length < 8) return false;
      if (PLACEHOLDER_RE.test(value) || TEST_VALUE_RE.test(value) || !looksRandom(value))
        return false;
      return !(CODE_FILE_RE.test(file) && quote === '');
    },
  };
}

/** 벤더 키 형식 규칙 — 테스트 전용 표식(e2e/test/example…)이 든 값은 허용 (§4.7.5) */
function llmKey(name: string, pattern: RegExp): Rule {
  return {
    name,
    test: (line) => [...line.matchAll(pattern)].some((match) => !TEST_VALUE_RE.test(match[0])),
  };
}

export const RULES: readonly Rule[] = [
  {
    name: '원격 postgres 자격 증명',
    test: (line) =>
      [...line.matchAll(PG_URL_RE)].some(
        (match) =>
          !LOCAL_DB_HOSTS.has(match[3]!.toLowerCase()) &&
          !DUMMY_PASSWORDS.has(match[2]!.toLowerCase()),
      ),
  },
  assignment('AUTH_SECRET'),
  assignment('AUTH_GOOGLE_SECRET'),
  // PRAMI-003 §4.3.7 — Upstash REST 토큰 (Marketplace 주입값을 저장소에 두지 않는다)
  assignment('UPSTASH_REDIS_REST_TOKEN'),
  {
    name: 'Google OAuth 클라이언트 시크릿',
    test: (line) => /GOCSPX-[A-Za-z0-9_-]{10,}/.test(line),
  },
  {
    name: 'Google OAuth 클라이언트 ID',
    test: (line) => /\b\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/.test(line),
  },
  { name: 'Neon 비밀번호', test: (line) => /\bnpg_[A-Za-z0-9]{8,}\b/.test(line) },
  // PRAMI-002 §4.7.5 — LLM 벤더 키·KEK (문서에는 `sk-…abcd` 마스킹 형식과 `<ANTHROPIC_API_KEY>` 자리표시자만)
  llmKey('Anthropic API 키', /\bsk-ant-[A-Za-z0-9_-]{20,}/g),
  llmKey('OpenRouter API 키', /\bsk-or-[A-Za-z0-9_-]{20,}/g),
  llmKey('OpenAI API 키', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g),
  llmKey('Google API 키', /\bAIza[A-Za-z0-9_-]{35}\b/g),
  {
    name: 'LLM_CREDENTIALS_KEKS 값 대입',
    test: (line) => {
      const value = /LLM_CREDENTIALS_KEKS['"]?\s*[:=]\s*['"`]?([^\s'"`#;]+)/i.exec(line)?.[1];
      return Boolean(value && /\d+:[A-Za-z0-9+/_-]{43}=?/.test(value));
    },
  },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?|pdf|xlsx|zip|gz)$/i;
const SKIPPED_FILES = new Set(['pnpm-lock.yaml']);

export function scanText(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.test(line, file)) {
        findings.push({
          file,
          line: index + 1,
          rule: rule.name,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }
  });
  return findings;
}

export function scanFiles(root: string, files: readonly string[]): SecretFinding[] {
  return files
    .filter((file) => !BINARY_EXT.test(file) && !SKIPPED_FILES.has(path.basename(file)))
    .flatMap((file) => {
      let text: string;
      try {
        text = readFileSync(path.join(root, file), 'utf8');
      } catch {
        return [];
      }
      return scanText(file, text);
    });
}

export function trackedFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function main(): void {
  const root = process.argv[2] ?? process.cwd();
  const files = trackedFiles(root);
  const findings = scanFiles(root, files);
  if (findings.length === 0) {
    console.info(`[secret-scan] ${files.length}개 추적 파일에서 비밀값 패턴 없음`);
    return;
  }
  for (const finding of findings) {
    // 값 자체를 로그에 다시 남기지 않도록 앞부분만 보인다
    console.error(
      `[secret-scan] ${finding.file}:${finding.line} ${finding.rule} — ${finding.excerpt.slice(0, 40)}…`,
    );
  }
  console.error(
    `[secret-scan] ${findings.length}건 발견 — 비밀값은 Vercel 프로젝트 설정에만 두세요 (docs/deploy/vercel.md)`,
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]).includes('secret-scan')) main();
