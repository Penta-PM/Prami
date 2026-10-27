import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminItemsHref,
  DEFAULT_ADMIN_ITEMS_FILTER,
  type AdminItemsFilter,
} from '@/lib/procurement/admin-items-filter';
import type {
  AdminItemRow,
  ItemsAdminData,
  ItemTrashRow,
} from '@/features/procurement/admin/items/types';

/**
 * 조달이 통합 UI-7 품목 관리 화면 흐름 (jsdom, 서버 액션 모킹 — 합성 품목만).
 * 검토 카드(선택 추가·일괄 추가 확인 모달·제품 미정 안내·행 내 편집), 등록 품목(일괄 변경 확인·행 삭제 확인·수정 모달·직접 추가),
 * 휴지통(삭제자·되살리기), "이미 처리됨" 안내 후 새로고침. window.confirm/alert 를 쓰지 않는다.
 */
const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() },
  include: vi.fn(),
  exclude: vi.fn(),
  restore: vi.fn(),
  edit: vi.fn(),
  add: vi.fn(),
}));

vi.mock('@/features/procurement/admin/items/actions', () => ({
  includeReviewItemsAction: mocks.include,
  excludeItemsAction: mocks.exclude,
  restoreItemsAction: mocks.restore,
  editItemsAction: mocks.edit,
  addItemAction: mocks.add,
}));

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

const { ItemsAdminPanel } = await import('@/features/procurement/admin/items/ItemsAdminPanel');

function row(values: Partial<AdminItemRow> & { id: number }): AdminItemRow {
  return {
    itemId: `9000000${values.id}`,
    product: 'WAPPLES',
    productGroup: null,
    detailCategory: null,
    manufacturer: '가상제조',
    itemName: `가상 품목 ${values.id}`,
    registeredOn: '2026-10-20',
    collectedOn: null,
    status: 'active',
    reviewed: true,
    source: 'auto',
    version: `100${values.id}`,
    ...values,
  };
}

const PENDING_A = row({ id: 1, status: 'pending', reviewed: false, product: 'D.AMO' });
const PENDING_B = row({ id: 2, status: 'active', reviewed: false, product: 'WAPPLES' });
const UNDECIDED = row({ id: 3, status: 'pending', reviewed: false, product: '기타' });
const REG_1 = row({ id: 11, product: 'iSIGN', detailCategory: 'SSO' });
const REG_2 = row({ id: 12, product: 'WAPPLES', source: 'manual' });
const TRASHED: ItemTrashRow = {
  ...row({ id: 21, status: 'excluded' }),
  deletedBy: 'someone@pentasecurity.com',
  deletedAt: '2026-10-26T01:02:00.000Z',
};

function data(overrides: Partial<ItemsAdminData> = {}): ItemsAdminData {
  return {
    queue: { rows: [PENDING_A, PENDING_B, UNDECIDED], total: 3 },
    registered: { rows: [REG_1, REG_2], total: 2, page: 1, pageCount: 1, pageSize: 50 },
    trash: { rows: [TRASHED], total: 1, page: 1, pageCount: 1, pageSize: 50 },
    detailOptions: { WAPPLES: ['WAF'], iSIGN: ['SSO'] },
    ...overrides,
  };
}

const done = (ids: number[]) => ({ ok: true as const, data: { count: ids.length, ids } });

beforeEach(() => {
  for (const mock of [mocks.include, mocks.exclude, mocks.restore, mocks.edit, mocks.add])
    mock.mockReset();
  for (const mock of Object.values(mocks.router)) mock.mockReset();
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('window.confirm 금지');
  });
  vi.spyOn(window, 'alert').mockImplementation(() => {
    throw new Error('window.alert 금지');
  });
});

async function renderPanel(
  overrides: Partial<ItemsAdminData> = {},
  filter: AdminItemsFilter = DEFAULT_ADMIN_ITEMS_FILTER,
) {
  render(<ItemsAdminPanel filter={filter} data={data(overrides)} />);
  return screen.findByRole('region', { name: /일일 신규 품목/ });
}

describe('일일 신규 품목 카드', () => {
  it('건수 배지·행·제품 미정 표시, 비어 있으면 안내', async () => {
    const card = await renderPanel();
    expect(within(card).getByText('3건')).toBeInTheDocument();
    expect(within(card).getAllByRole('row')).toHaveLength(4);
    expect(
      within(card).getByRole('combobox', {
        name: `${UNDECIDED.itemId} ${UNDECIDED.itemName} 제품명`,
      }),
    ).toHaveDisplayValue('제품 선택');
  });

  it('빈 목록 안내', async () => {
    const card = await renderPanel({ queue: { rows: [], total: 0 } });
    expect(card).toHaveTextContent('새로 들어온 품목이 없습니다');
  });

  it('선택 추가: 체크한 품목만 version 과 함께 보내고, 성공 안내 후 다시 불러온다', async () => {
    mocks.include.mockResolvedValue(done([1]));
    const card = await renderPanel();
    await userEvent.click(
      within(card).getByRole('checkbox', {
        name: `${PENDING_A.itemId} ${PENDING_A.itemName} 선택`,
      }),
    );
    await userEvent.click(within(card).getByRole('button', { name: '선택 추가 (1)' }));
    expect(mocks.include).toHaveBeenCalledWith({ targets: [{ id: 1, version: '1001' }] });
    expect(await screen.findByRole('status')).toHaveTextContent('1건을 등록 품목에 추가했습니다');
    expect(mocks.router.refresh).toHaveBeenCalled();
  });

  it('일괄 추가: 확인 모달(제품 미정 안내 포함) → 확인하면 제품이 정해진 품목만 보낸다', async () => {
    mocks.include.mockResolvedValue(done([1, 2]));
    const card = await renderPanel();
    await userEvent.click(within(card).getByRole('button', { name: '일괄 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '일괄 추가' });
    expect(dialog).toHaveTextContent('제품이 정해지지 않은 1건');
    expect(mocks.include).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: '2건 추가' }));
    expect(mocks.include).toHaveBeenCalledWith({
      targets: [
        { id: 1, version: '1001' },
        { id: 2, version: '1002' },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('제품 미정만 추가하려 하면 서버를 부르지 않고 안내', async () => {
    const card = await renderPanel();
    await userEvent.click(
      within(card).getByRole('button', { name: `${UNDECIDED.itemId} ${UNDECIDED.itemName} 추가` }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('제품을 먼저 골라야');
    expect(mocks.include).not.toHaveBeenCalled();
  });

  it('행 내 제품 고르기·세부분류 입력(Enter)은 바로 저장(edit)', async () => {
    mocks.edit.mockResolvedValue(done([3]));
    const card = await renderPanel();
    await userEvent.selectOptions(
      within(card).getByRole('combobox', {
        name: `${UNDECIDED.itemId} ${UNDECIDED.itemName} 제품명`,
      }),
      'iSIGN',
    );
    expect(mocks.edit).toHaveBeenLastCalledWith({
      targets: [{ id: 3, version: '1003' }],
      patch: { product: 'iSIGN' },
    });
    const detail = within(card).getByRole('combobox', {
      name: `${PENDING_A.itemId} ${PENDING_A.itemName} 세부분류`,
    });
    // 저장·새로고침 동안은 잠긴다
    await waitFor(() => expect(detail).toBeEnabled());
    await userEvent.type(detail, '암호화{Enter}');
    expect(mocks.edit).toHaveBeenLastCalledWith({
      targets: [{ id: 1, version: '1001' }],
      patch: { detailCategory: '암호화' },
    });
  });

  it('선택 삭제: Prami 확인 모달 → 삭제', async () => {
    mocks.exclude.mockResolvedValue(done([2]));
    const card = await renderPanel();
    await userEvent.click(
      within(card).getByRole('checkbox', {
        name: `${PENDING_B.itemId} ${PENDING_B.itemName} 선택`,
      }),
    );
    await userEvent.click(within(card).getByRole('button', { name: '선택 삭제' }));
    const dialog = await screen.findByRole('dialog', { name: '휴지통으로 옮기기' });
    expect(dialog).toHaveTextContent(`${PENDING_B.itemId} (WAPPLES)을 휴지통으로 옮길까요?`);
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(mocks.exclude).toHaveBeenCalledWith({ targets: [{ id: 2, version: '1002' }] });
  });

  it('이미 처리됨(CONFLICT): 경고 안내 + 목록 새로 불러오기, 모달은 닫힌다', async () => {
    mocks.exclude.mockResolvedValue({
      ok: false,
      error: {
        code: 'CONFLICT',
        message:
          '이미 처리됨 — 다른 사용자가 먼저 바꾼 품목이 1건 있습니다. 목록을 새로 불러옵니다.',
        details: { alreadyProcessed: [1] },
      },
    });
    const card = await renderPanel();
    await userEvent.click(
      within(card).getByRole('button', { name: `${PENDING_A.itemId} ${PENDING_A.itemName} 삭제` }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '삭제' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('이미 처리됨');
    expect(mocks.router.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('그 밖의 오류는 모달 안에 남긴다', async () => {
    mocks.exclude.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: '요청을 처리하지 못했습니다' },
    });
    const card = await renderPanel();
    await userEvent.click(
      within(card).getByRole('button', { name: `${PENDING_A.itemId} ${PENDING_A.itemName} 삭제` }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '요청을 처리하지 못했습니다',
    );
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
});

describe('등록 품목 카드', () => {
  async function registeredCard() {
    await renderPanel();
    return screen.getByRole('region', { name: /등록 품목/ });
  }

  it('일괄 변경: 선택 → 제품명·세부분류 → 적용 → 확인 모달 → edit', async () => {
    mocks.edit.mockResolvedValue(done([11, 12]));
    const card = await registeredCard();
    await userEvent.click(within(card).getByRole('checkbox', { name: '보이는 품목 전체 선택' }));
    const bar = within(card).getByRole('group', { name: '선택한 품목 일괄 변경' });
    expect(bar).toHaveTextContent('2건 선택');
    await userEvent.selectOptions(
      within(bar).getByRole('combobox', { name: '제품명 일괄 변경' }),
      'iSIGN',
    );
    await userEvent.selectOptions(
      within(bar).getByRole('combobox', { name: '세부분류 일괄 변경' }),
      'PKI',
    );
    await userEvent.click(within(bar).getByRole('button', { name: '적용' }));
    const dialog = await screen.findByRole('dialog', { name: '일괄 변경' });
    expect(dialog).toHaveTextContent('2건의 제품명 → iSIGN, 세부분류 → PKI(으)로 바꿀까요?');
    await userEvent.click(within(dialog).getByRole('button', { name: '적용' }));
    expect(mocks.edit).toHaveBeenCalledWith({
      targets: [
        { id: 11, version: '10011' },
        { id: 12, version: '10012' },
      ],
      patch: { product: 'iSIGN', detailCategory: 'PKI' },
    });
  });

  it('행 수정 모달: 전 칸 저장, 오류는 모달에 남긴다', async () => {
    mocks.edit
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'CONFLICT', message: '이미 WAPPLES에 있는 물품식별번호입니다' },
      })
      .mockResolvedValueOnce(done([12]));
    const card = await registeredCard();
    await userEvent.click(
      within(card).getByRole('button', { name: `${REG_2.itemId} WAPPLES 수정` }),
    );
    const dialog = await screen.findByRole('dialog', { name: '품목 수정' });
    const name = within(dialog).getByRole('textbox', { name: '품목' });
    await userEvent.clear(name);
    await userEvent.type(name, '새 이름');
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('이미 WAPPLES에 있는');
    expect(mocks.edit).toHaveBeenLastCalledWith({
      targets: [{ id: 12, version: '10012' }],
      patch: {
        product: 'WAPPLES',
        detailCategory: '',
        manufacturer: '가상제조',
        itemId: REG_2.itemId,
        itemName: '새 이름',
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('행 삭제는 확인 모달을 거친다', async () => {
    mocks.exclude.mockResolvedValue(done([11]));
    const card = await registeredCard();
    await userEvent.click(within(card).getByRole('button', { name: `${REG_1.itemId} iSIGN 삭제` }));
    const dialog = await screen.findByRole('dialog', { name: '휴지통으로 옮기기' });
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(mocks.exclude).not.toHaveBeenCalled();
  });

  it('직접 추가: 물품식별번호 필수, 추가하면 addItemAction', async () => {
    mocks.add.mockResolvedValue(done([99]));
    const card = await registeredCard();
    await userEvent.click(within(card).getByRole('button', { name: '+ 직접 추가' }));
    const form = within(card).getByRole('form', { name: '품목 직접 추가' });
    await userEvent.click(within(form).getByRole('button', { name: '추가' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('물품식별번호를 입력하세요');
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: '제품명 *' }),
      'D.AMO',
    );
    await userEvent.type(within(form).getByRole('textbox', { name: '물품식별번호 *' }), '77770001');
    await userEvent.type(within(form).getByRole('textbox', { name: '품목명' }), '가상 암호화');
    await userEvent.click(within(form).getByRole('button', { name: '추가' }));
    expect(mocks.add).toHaveBeenCalledWith({
      product: 'D.AMO',
      itemId: '77770001',
      itemName: '가상 암호화',
      manufacturer: '',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'D.AMO 77770001 를 등록 품목에 추가했습니다',
    );
  });

  it('검색·제품 필터 → 1페이지로 router.replace, 페이지·정렬 → router.push (URL 이 상태)', async () => {
    await renderPanel({
      registered: { rows: [REG_1], total: 120, page: 1, pageCount: 3, pageSize: 50 },
    });
    const card = screen.getByRole('region', { name: /등록 품목/ });
    await userEvent.type(
      within(card).getByRole('textbox', { name: '물품식별번호·품목·제조사 검색' }),
      '가상{Enter}',
    );
    expect(mocks.router.replace).toHaveBeenLastCalledWith(adminItemsHref({ q: '가상' }), {
      scroll: false,
    });
    await userEvent.selectOptions(
      within(card).getByRole('combobox', { name: '제품명 필터' }),
      'iSIGN',
    );
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      '/admin/procurement?tab=items&q=%EA%B0%80%EC%83%81&product=iSIGN',
      { scroll: false },
    );
    await userEvent.click(
      within(within(card).getByRole('navigation', { name: '등록 품목 페이지' })).getByRole(
        'button',
        { name: '다음' },
      ),
    );
    expect(mocks.router.push).toHaveBeenLastCalledWith('/admin/procurement?tab=items&page=2', {
      scroll: false,
    });
    await userEvent.click(within(card).getByRole('button', { name: /물품식별번호/ }));
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      '/admin/procurement?tab=items&sort=itemId&dir=asc',
      { scroll: false },
    );
  });

  it('딥링크 조건을 그대로 보여 준다 (검색어·제품·정렬 표시, 휴지통 페이지면 휴지통 펼침)', async () => {
    const filter: AdminItemsFilter = {
      q: '가상',
      product: 'iSIGN',
      page: 1,
      trashPage: 2,
      sort: { id: 'itemId', dir: 'desc' },
    };
    await renderPanel(
      { trash: { rows: [TRASHED], total: 60, page: 2, pageCount: 2, pageSize: 50 } },
      filter,
    );
    const card = screen.getByRole('region', { name: /등록 품목/ });
    expect(
      within(card).getByRole('textbox', { name: '물품식별번호·품목·제조사 검색' }),
    ).toHaveValue('가상');
    expect(within(card).getByRole('combobox', { name: '제품명 필터' })).toHaveValue('iSIGN');
    expect(
      within(within(card).getByRole('table', { name: '등록 품목' })).getByRole('columnheader', {
        name: /물품식별번호/,
      }),
    ).toHaveAttribute('aria-sort', 'descending');
    expect(within(card).getByRole('region', { name: '휴지통' })).toHaveTextContent('2 / 2 페이지');
    // 같은 열을 다시 누르면 오름차순
    await userEvent.click(within(card).getByRole('button', { name: /물품식별번호/ }));
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      adminItemsHref({ ...filter, sort: { id: 'itemId', dir: 'asc' }, page: 1 }),
      { scroll: false },
    );
  });

  it('휴지통: 삭제자·삭제 시각(KST) 표시, 되살리기', async () => {
    mocks.restore.mockResolvedValue(done([21]));
    const card = await registeredCard();
    await userEvent.click(within(card).getByRole('button', { name: '휴지통 1' }));
    const trash = within(card).getByRole('region', { name: '휴지통' });
    expect(trash).toHaveTextContent('someone@pentasecurity.com');
    expect(trash).toHaveTextContent('2026-10-26 10:02');
    await userEvent.click(
      within(trash).getByRole('button', { name: `${TRASHED.itemId} WAPPLES 되살리기` }),
    );
    expect(mocks.restore).toHaveBeenCalledWith({ targets: [{ id: 21, version: '10021' }] });
    expect(await screen.findByRole('status')).toHaveTextContent('되살렸습니다');
  });
});
