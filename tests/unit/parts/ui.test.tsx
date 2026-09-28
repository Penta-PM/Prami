import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupCandidateView, SolutionGroupView } from '@/features/groups/types';
import type { CatalogItemView, PartMappingView } from '@/features/parts/types';

/** 파츠 관리·솔루션 그룹 화면 컴포넌트 — Server Action·라우터는 모킹 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  apply: vi.fn(),
  upsertGroup: vi.fn(),
  removeGroup: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
  usePathname: () => '/admin/parts',
}));
vi.mock('@/features/parts/actions', () => ({
  savePartMappingAction: mocks.save,
  deletePartMappingAction: mocks.remove,
  applyPartImportAction: mocks.apply,
}));
vi.mock('@/features/groups/actions', () => ({
  upsertSolutionGroupAction: mocks.upsertGroup,
  deleteSolutionGroupAction: mocks.removeGroup,
}));

const { PartsManager } = await import('@/features/parts/PartsManager');
const { GroupsManager } = await import('@/features/groups/GroupsManager');
const { FamilyTabs } = await import('@/features/parts/FamilyTabs');

const MODELS: CatalogItemView[] = [
  { itemCode: 'P1010010004', itemName: 'Wapples-2700 (H2700)' },
  { itemCode: 'P1010010005', itemName: 'Wapples-2700 (H2700)-RAID' },
];
const PARTS: CatalogItemView[] = [
  { itemCode: 'P10800011', itemName: 'N_51080 - 1G UTP 8포트(바이패스X)' },
  { itemCode: 'P10800009', itemName: 'N_51240 - 1G UTP 4포트(바이패스)' },
];
const MAPPING: PartMappingView = {
  modelItemCode: 'P1010010005',
  modelName: 'Wapples-2700 (H2700)-RAID',
  parts: [PARTS[1]!],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PartsManager (AC-30·31)', () => {
  it('모델 선택 → 파츠 체크 → 칩 → 저장: savePartMappingAction 호출, 표는 모델별 1행(품명(품번))', async () => {
    mocks.save.mockResolvedValue({
      ok: true,
      data: { modelItemCode: 'P1010010004', partItemCodes: ['P10800011'], replaced: false },
    });
    render(<PartsManager models={MODELS} parts={PARTS} mappings={[MAPPING]} batchOptions={[]} />);
    const table = screen.getByRole('table', { name: '등록된 매핑 표' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(table).toHaveTextContent('N_51240 - 1G UTP 4포트(바이패스) (P10800009)');

    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    await userEvent.type(screen.getByRole('searchbox', { name: '모델 검색' }), '2700 (H2700)');
    await userEvent.click(
      screen.getByRole('button', { name: 'Wapples-2700 (H2700) (P1010010004)' }),
    );
    await userEvent.type(screen.getByRole('searchbox', { name: '파츠 검색' }), '51080');
    const list = screen.getByRole('group', { name: '파츠 목록' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('checkbox'));
    expect(screen.getByLabelText('선택된 파츠')).toHaveTextContent('N_51080');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(mocks.save).toHaveBeenCalledWith({
      modelItemCode: 'P1010010004',
      partItemCodes: ['P10800011'],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('저장했습니다 — 파츠 1건');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('이미 매핑된 모델 재선택 → 경고, 저장 시 교체 문구; 표의 수정 → 편집 모드로 체크 복원; 삭제 확인', async () => {
    mocks.save.mockResolvedValue({
      ok: true,
      data: { modelItemCode: 'P1010010005', partItemCodes: ['P10800011'], replaced: true },
    });
    mocks.remove.mockResolvedValue({
      ok: true,
      data: { modelItemCode: 'P1010010005', removed: 1 },
    });
    render(<PartsManager models={MODELS} parts={PARTS} mappings={[MAPPING]} batchOptions={[]} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Wapples-2700 (H2700)-RAID (P1010010005)' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('이미 등록된 모델입니다');
    expect(
      screen.getByRole('button', { name: 'Wapples-2700 (H2700)-RAID (P1010010005)' }),
    ).toHaveTextContent('등록됨');

    await userEvent.click(
      screen.getByRole('button', { name: 'Wapples-2700 (H2700)-RAID 매핑 수정' }),
    );
    expect(
      screen.getByRole('heading', { name: /매핑 수정 · Wapples-2700 \(H2700\)-RAID/ }),
    ).toBeInTheDocument();
    const list = screen.getByRole('group', { name: '파츠 목록' });
    const boxes = within(list).getAllByRole('checkbox');
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    await userEvent.click(screen.getByRole('button', { name: '매핑 수정 저장' }));
    expect(mocks.save).toHaveBeenCalledWith({
      modelItemCode: 'P1010010005',
      partItemCodes: ['P10800011'],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('기존 매핑을 새 선택 1건으로 교체');

    await userEvent.click(
      screen.getByRole('button', { name: 'Wapples-2700 (H2700)-RAID 매핑 삭제' }),
    );
    const dialog = screen.getByRole('dialog', { name: '매핑 삭제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(mocks.remove).toHaveBeenCalledWith({ modelItemCode: 'P1010010005' });
    expect(await screen.findByRole('status')).toHaveTextContent('삭제했습니다');
  });

  it('엑셀 등록 모드: 업로드 버튼과 적용 버튼(업로드 전 비활성)', async () => {
    render(<PartsManager models={MODELS} parts={PARTS} mappings={[]} batchOptions={[]} />);
    await userEvent.click(screen.getByRole('radio', { name: '엑셀 등록' }));
    expect(screen.getByRole('button', { name: '파츠 엑셀 업로드' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '매핑 적용' })).toBeDisabled();
    expect(screen.getByText('등록된 매핑이 없습니다.')).toBeInTheDocument();
  });
});

const CANDIDATES: GroupCandidateView[] = [
  { itemCode: 'P1', itemName: 'Wapples-500 (H500 T2)', unitPrice: '12500000.00', currency: 'KRW' },
  { itemCode: 'P2', itemName: 'Wapples-1000 (H1000)', unitPrice: '20000000.00', currency: 'KRW' },
];
const GROUP: SolutionGroupView = {
  id: '22222222-0000-4000-8000-000000000001',
  productFamily: 'WAPPLES',
  name: 'WAPPLES 기본',
  items: [
    {
      itemCode: 'P1',
      itemName: 'Wapples-500 (H500 T2)',
      defaultQty: 1,
      unitPrice: '12500000.00',
      currency: 'KRW',
    },
  ],
};

describe('GroupsManager (AC-33)', () => {
  it('카드(그룹명 + 항목 칩·현재 단가), + 그룹 생성 → 항목 체크 → 저장', async () => {
    mocks.upsertGroup.mockResolvedValue({ ok: true, data: { id: 'g2', name: '새 그룹' } });
    render(<GroupsManager family="WAPPLES" groups={[GROUP]} candidates={CANDIDATES} />);
    const card = within(screen.getByRole('list', { name: '솔루션 그룹 목록' })).getAllByRole(
      'listitem',
    )[0]!;
    expect(card).toHaveTextContent('WAPPLES 기본');
    expect(card).toHaveTextContent('Wapples-500 (H500 T2)12,500,000원');

    await userEvent.click(screen.getByRole('button', { name: '+ 그룹 생성' }));
    const dialog = screen.getByRole('dialog', { name: '그룹 생성' });
    await userEvent.type(within(dialog).getByLabelText('그룹명'), '새 그룹');
    const boxes = within(
      within(dialog).getByRole('group', { name: '상세 제품 목록' }),
    ).getAllByRole('checkbox');
    await userEvent.click(boxes[1]!);
    expect(dialog).toHaveTextContent('20,000,000원');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(mocks.upsertGroup).toHaveBeenCalledWith({
      productFamily: 'WAPPLES',
      name: '새 그룹',
      items: [{ itemCode: 'P2', defaultQty: 1 }],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('생성했습니다: 새 그룹');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('수정은 기존 값으로 채워 id 를 보내고, 삭제는 확인 후 deleteSolutionGroupAction', async () => {
    mocks.upsertGroup.mockResolvedValue({ ok: true, data: { id: GROUP.id, name: 'WAPPLES 기본' } });
    mocks.removeGroup.mockResolvedValue({ ok: true, data: { id: GROUP.id, name: 'WAPPLES 기본' } });
    render(<GroupsManager family="WAPPLES" groups={[GROUP]} candidates={CANDIDATES} />);
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES 기본 수정' }));
    const dialog = screen.getByRole('dialog', { name: '그룹 수정' });
    expect(within(dialog).getByLabelText('그룹명')).toHaveValue('WAPPLES 기본');
    const boxes = within(
      within(dialog).getByRole('group', { name: '상세 제품 목록' }),
    ).getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(mocks.upsertGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: GROUP.id, name: 'WAPPLES 기본' }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES 기본 삭제' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '그룹 삭제' })).getByRole('button', {
        name: '삭제',
      }),
    );
    expect(mocks.removeGroup).toHaveBeenCalledWith({ id: GROUP.id });
    expect(await screen.findByRole('status')).toHaveTextContent('삭제했습니다');
  });
});

describe('FamilyTabs', () => {
  it('제품군 탭 링크 + 현재 탭 aria-current + 건수', () => {
    render(
      <FamilyTabs
        families={['WAPPLES', 'D.AMO']}
        active="D.AMO"
        basePath="/admin/groups"
        counts={{ WAPPLES: 2, 'D.AMO': 0 }}
      />,
    );
    const links = within(screen.getByRole('navigation', { name: '제품군' })).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/admin/groups?family=WAPPLES');
    expect(links[0]).toHaveTextContent('WAPPLES2');
    expect(links[1]).toHaveAttribute('aria-current', 'page');
  });
});
