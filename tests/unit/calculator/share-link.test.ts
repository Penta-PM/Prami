import { describe, expect, it, vi } from 'vitest';

import {
  canNativeShare,
  copyLink,
  shareOrCopy,
  shareTitle,
  type ShareNavigator,
} from '@/features/calculator/share-link';

/** 모바일 UI 스펙 §9 MOB-DS-103: 공유 → 닫으면 조용히 → 그 밖 오류는 복사로 대체 (⑤ 단위) */
const URL = 'https://prami.example/share/quotes/abc';
const TITLE = shareTitle('Q-2026-0003');

function nav(over: Partial<ShareNavigator> = {}): ShareNavigator {
  return { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }, ...over };
}

describe('share-link', () => {
  it('MOB-SR-103.1: share 가 있으면 제목·절대 URL 만으로 공유한다(금액 없음)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const target = nav({ share });
    expect(canNativeShare(target)).toBe(true);
    await expect(shareOrCopy(target, { title: TITLE, url: URL })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Prami 견적서 Q-2026-0003', url: URL });
    expect(target.clipboard!.writeText).not.toHaveBeenCalled();
  });

  it('MOB-SR-103.2: 사용자가 공유 창을 닫으면(AbortError) aborted — 복사하지 않는다', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    const target = nav({ share: vi.fn().mockRejectedValue(abort) });
    await expect(shareOrCopy(target, { title: TITLE, url: URL })).resolves.toBe('aborted');
    expect(target.clipboard!.writeText).not.toHaveBeenCalled();
  });

  it('MOB-SR-103.3: 그 밖의 오류는 클립보드 복사로 대체, 복사도 실패하면 failed', async () => {
    const target = nav({ share: vi.fn().mockRejectedValue(new TypeError('not allowed')) });
    await expect(shareOrCopy(target, { title: TITLE, url: URL })).resolves.toBe('copied');
    expect(target.clipboard!.writeText).toHaveBeenCalledWith(URL);

    const broken = nav({
      share: vi.fn().mockRejectedValue(null),
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(shareOrCopy(broken, { title: TITLE, url: URL })).resolves.toBe('failed');
  });

  it('share 가 없으면 바로 복사, navigator·clipboard 가 없으면 failed', async () => {
    const target = nav();
    expect(canNativeShare(target)).toBe(false);
    await expect(shareOrCopy(target, { title: TITLE, url: URL })).resolves.toBe('copied');
    expect(canNativeShare(undefined)).toBe(false);
    await expect(copyLink(undefined, URL)).resolves.toBe(false);
    await expect(shareOrCopy({}, { title: TITLE, url: URL })).resolves.toBe('failed');
  });
});
