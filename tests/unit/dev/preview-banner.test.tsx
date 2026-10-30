import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { previewBannerText, readGitHead, resetPreviewCache } = await import('@/server/dev/preview');

/**
 * :3000 미리보기 띠 (docs/specs/preview-on-3000.md §6). 합성 .git 을 임시 폴더에 만들어 HEAD 상태별로 본다.
 */
const MAIN_SHA = 'a'.repeat(40);
const FEAT_SHA = 'b'.repeat(40);
const OTHER_SHA = 'c'.repeat(40);

let root: string;

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${text}\n`);
}

/** 워크트리 모양: <root>/wt/.git = "gitdir: ../common/worktrees/wt", commondir = ../.. */
function worktree(head: string) {
  const common = path.join(root, 'common');
  const gitDir = path.join(common, 'worktrees', 'wt');
  write(path.join(root, 'wt', '.git'), 'gitdir: ../common/worktrees/wt');
  write(path.join(gitDir, 'commondir'), '../..');
  write(path.join(gitDir, 'HEAD'), head);
  write(path.join(common, 'refs', 'heads', 'feat', 'x'), FEAT_SHA);
  write(path.join(common, 'refs', 'remotes', 'origin', 'feat', 'x'), FEAT_SHA);
  // main 은 packed-refs 에만 (loose 가 없어도 찾는다)
  write(
    path.join(common, 'packed-refs'),
    `# pack-refs with: peeled fully-peeled sorted\n${MAIN_SHA} refs/heads/main\n${MAIN_SHA} refs/remotes/origin/main`,
  );
  return path.join(root, 'wt');
}

const text = (dir: string, env = 'development', now = 0) => {
  resetPreviewCache();
  return previewBannerText(env, dir, now, undefined);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'prami-preview-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('previewBannerText', () => {
  it('브랜치 main → 띠 없음', () => {
    expect(text(worktree('ref: refs/heads/main'))).toBeNull();
  });

  it('브랜치 feat/x → "미리보기 중 — feat/x @ SHA7 (main 아님)"', () => {
    expect(text(worktree('ref: refs/heads/feat/x'))).toBe(
      '미리보기 중 — feat/x @ bbbbbbb (main 아님)',
    );
  });

  it('detached: origin 브랜치와 같은 SHA 면 그 이름, 아무 브랜치도 아니면 "detached"', () => {
    expect(text(worktree(FEAT_SHA))).toBe('미리보기 중 — feat/x @ bbbbbbb (main 아님)');
    expect(text(worktree(OTHER_SHA))).toBe('미리보기 중 — detached @ ccccccc (main 아님)');
  });

  it('detached 인데 main(origin/main) 과 같은 SHA → main 으로 보고 띠 없음 (:3000 기본 상태)', () => {
    expect(text(worktree(MAIN_SHA))).toBeNull();
  });

  it('일반 저장소(.git 디렉터리)도 읽는다', () => {
    write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feat/y');
    write(path.join(root, '.git', 'refs', 'heads', 'feat', 'y'), OTHER_SHA);
    expect(text(root)).toBe('미리보기 중 — feat/y @ ccccccc (main 아님)');
  });

  it.each([
    ['.git 없음', () => root],
    ['HEAD 가 가리키는 ref 없음', () => worktree('ref: refs/heads/none')],
    ['HEAD 가 깨짐', () => worktree('garbage')],
  ])('읽기 실패(%s) → 띠 없음', (_label, dir) => {
    expect(text(dir())).toBeNull();
  });

  it('production·test → fs 를 읽지 않고 띠 없음', () => {
    const dir = worktree('ref: refs/heads/feat/x');
    expect(text(dir, 'production')).toBeNull();
    expect(text(dir, 'test')).toBeNull();
  });

  it('PREVIEW_BANNER=off (E2E 서버) → 띠 없음', () => {
    const dir = worktree('ref: refs/heads/feat/x');
    resetPreviewCache();
    expect(previewBannerText('development', dir, 0, 'off')).toBeNull();
  });

  it('≈5초 캐시: 5초 안에는 이전 값, 지나면 다시 읽는다 (재시작 없이 체크아웃 전환 반영)', () => {
    const dir = worktree('ref: refs/heads/feat/x');
    resetPreviewCache();
    expect(previewBannerText('development', dir, 1_000, undefined)).toMatch(/feat\/x/);
    write(path.join(root, 'common', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/main');
    expect(previewBannerText('development', dir, 5_999, undefined)).toMatch(/feat\/x/);
    expect(previewBannerText('development', dir, 6_000, undefined)).toBeNull();
  });

  it('readGitHead: 브랜치·SHA', () => {
    expect(readGitHead(worktree('ref: refs/heads/feat/x'))).toMatchObject({
      branch: 'feat/x',
      sha: FEAT_SHA,
      isMain: false,
    });
  });
});

describe('PreviewBanner', () => {
  it('main 이 아니면 role=status 띠(warning-50/800, 14px, 높이 28px), 아니면 아무것도 없음', async () => {
    const { PreviewBanner } = await import('@/components/PreviewBanner');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PREVIEW_BANNER', '');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(worktree('ref: refs/heads/feat/x'));
    resetPreviewCache();
    const { unmount } = render(<PreviewBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('미리보기 중 — feat/x @ bbbbbbb (main 아님)');
    expect(banner).toHaveClass('bg-warning-50', 'text-warning-800', 'text-[14px]', 'h-7');
    unmount();

    cwd.mockReturnValue(worktree('ref: refs/heads/main'));
    resetPreviewCache();
    const { container } = render(<PreviewBanner />);
    expect(container).toBeEmptyDOMElement();
    cwd.mockRestore();
  });
});
