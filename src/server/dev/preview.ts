import 'server-only';

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';

/**
 * :3000 미리보기 표시 (docs/specs/preview-on-3000.md §6): 개발 서버가 main 이 아닌 커밋을 보여 줄 때 화면 맨 위 띠의 글.
 * 요청 시점에 워크트리 `.git` → gitdir 의 HEAD 를 fs 로 읽는다(HMR 로 체크아웃이 바뀌어도 재시작 없이 반영), ≈5초 캐시.
 * production 에서는 fs 를 읽지 않고 바로 null. 읽기 실패도 조용히 null(띠 없음). 화면에는 브랜치명·SHA 7자만.
 * E2E 서버도 next dev 라 `PREVIEW_BANNER=off`(playwright.config E2E_ENV)로 끈다 — role=status 띠가 화면 단언과 겹치지 않게.
 *
 * detached HEAD: :3000 워크트리는 main 이 Main 워크트리에 체크아웃돼 있어 main 도 detached(origin/main)로 둔다 —
 * SHA 가 main(로컬·origin) 과 같으면 main 으로 보고 띠 없음. 다르면 같은 SHA 의 origin 브랜치 이름을, 없으면 "detached" 를 쓴다.
 */
export type GitHead = { branch: string | null; sha: string };

const CACHE_MS = 5_000;
const MAIN_REFS = ['refs/heads/main', 'refs/remotes/origin/main'];
const SHA_RE = /^[0-9a-f]{40}$/;

function read(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** `.git` 이 디렉터리면 그대로, 워크트리의 `gitdir: …` 파일이면 그 경로. commondir 은 refs·packed-refs 가 있는 곳 */
function gitDirs(root: string): { gitDir: string; commonDir: string } | null {
  const dotGit = path.join(root, '.git');
  const pointer = read(dotGit);
  const gitDir = pointer?.startsWith('gitdir:')
    ? path.resolve(root, pointer.slice('gitdir:'.length).trim())
    : read(path.join(dotGit, 'HEAD')) !== null
      ? dotGit
      : null;
  if (!gitDir) return null;
  const common = read(path.join(gitDir, 'commondir'));
  return { gitDir, commonDir: common ? path.resolve(gitDir, common) : gitDir };
}

/** ref → SHA (worktree gitdir → commondir loose ref → packed-refs) */
function resolveRef(dirs: { gitDir: string; commonDir: string }, ref: string): string | null {
  for (const dir of [dirs.gitDir, dirs.commonDir]) {
    const sha = read(path.join(dir, ref));
    if (sha && SHA_RE.test(sha)) return sha;
  }
  return packedRefs(dirs.commonDir).get(ref) ?? null;
}

function packedRefs(commonDir: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of (read(path.join(commonDir, 'packed-refs')) ?? '').split('\n')) {
    const [sha, ref] = line.split(' ');
    if (sha && ref && SHA_RE.test(sha)) refs.set(ref, sha);
  }
  return refs;
}

/** SHA 를 가리키는 origin 브랜치 이름(loose → packed, main·HEAD 제외) */
function originBranchAt(commonDir: string, sha: string): string | null {
  const names = new Map<string, string>(packedRefs(commonDir));
  const base = path.join(commonDir, 'refs', 'remotes', 'origin');
  const walk = (dir: string, prefix: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${name}/`);
      else {
        const value = read(path.join(dir, entry.name));
        if (value && SHA_RE.test(value)) names.set(`refs/remotes/origin/${name}`, value);
      }
    }
  };
  walk(base, '');
  for (const [ref, value] of names) {
    if (value !== sha || !ref.startsWith('refs/remotes/origin/')) continue;
    const name = ref.slice('refs/remotes/origin/'.length);
    if (name !== 'HEAD' && name !== 'main') return name;
  }
  return null;
}

/** 워크트리 루트의 HEAD — 브랜치(detached 면 null)와 SHA. 읽기 실패면 null */
export function readGitHead(
  root: string,
): (GitHead & { isMain: boolean; originBranch: string | null }) | null {
  const dirs = gitDirs(root);
  if (!dirs) return null;
  const head = read(path.join(dirs.gitDir, 'HEAD'));
  if (!head) return null;
  if (head.startsWith('ref: ')) {
    const ref = head.slice('ref: '.length);
    const sha = resolveRef(dirs, ref);
    if (!sha) return null;
    const branch = ref.replace(/^refs\/heads\//, '');
    return { branch, sha, isMain: branch === 'main', originBranch: null };
  }
  if (!SHA_RE.test(head)) return null;
  const isMain = MAIN_REFS.some((ref) => resolveRef(dirs, ref) === head);
  return {
    branch: null,
    sha: head,
    isMain,
    originBranch: isMain ? null : originBranchAt(dirs.commonDir, head),
  };
}

/** 띠 글. main 이면 null */
export function previewLabel(head: ReturnType<typeof readGitHead>): string | null {
  if (!head || head.isMain) return null;
  const name = head.branch ?? head.originBranch ?? 'detached';
  return `미리보기 중 — ${name} @ ${head.sha.slice(0, 7)} (main 아님)`;
}

let cache: { at: number; root: string; label: string | null } | null = null;

/** 요청마다 호출 — development 에서만 읽고 5초 캐시. production·실패는 null */
export function previewBannerText(
  env: string | undefined = process.env.NODE_ENV,
  root: string = process.cwd(),
  now: number = Date.now(),
  switchValue: string | undefined = process.env.PREVIEW_BANNER,
): string | null {
  if (env !== 'development' || switchValue === 'off') return null;
  if (cache && cache.root === root && now - cache.at < CACHE_MS) return cache.label;
  let label: string | null = null;
  try {
    label = previewLabel(readGitHead(root));
  } catch {
    label = null;
  }
  cache = { at: now, root, label };
  return label;
}

/** 테스트 전용 */
export function resetPreviewCache() {
  cache = null;
}
