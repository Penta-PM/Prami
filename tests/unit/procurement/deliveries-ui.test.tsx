import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeliveriesAdminProps } from '@/features/procurement/admin/deliveries/DeliveriesAdmin';
import {
  adminDeliveriesHref,
  normalizeAdminDeliveriesQuery,
  parseAdminDeliveriesView,
  toDeliveryListQuery,
} from '@/lib/procurement/admin-deliveries-filter';
import {
  canonicalDeliveryValue,
  DELIVERY_EDIT_FIELDS,
  parseDeliveryFieldValue,
  type DeliveryValues,
} from '@/features/procurement/admin/deliveries/fields';
import type { DeliveryAdminRow, DeliveryDetail } from '@/server/procurement/deliveries';

import { toggleField } from '../table-filter/server-quick-helpers';

/**
 * 조달이 통합 UI-6 실적 관리 화면 — URL 코덱(화이트리스트·정규화), 표(백만원 머리글)·빠른 필터(server → router.replace)·정렬/페이지/하위 화면
 * (push)·편집 드로어(전 필드 + 이력)·확인 모달(window.confirm 없음)·쓰기 뒤 router.refresh·"이미 처리됨" 안내. 서버 액션·라우터는 모킹(합성 데이터).
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  detail: vi.fn(),
  update: vi.fn(),
  exclude: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => '/admin/procurement',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/procurement/admin/deliveries/actions', () => ({
  getDeliveryDetailAction: mocks.detail,
  updateDeliveryAction: mocks.update,
  excludeDeliveryAction: mocks.exclude,
  restoreDeliveryAction: mocks.restore,
}));

const { DeliveriesAdmin } = await import('@/features/procurement/admin/deliveries/DeliveriesAdmin');

function row(
  values: Partial<DeliveryAdminRow> & { id: number; dlvrReqNo: string },
): DeliveryAdminRow {
  return {
    changeOrd: '00',
    dlvrReqDate: '2026-03-01',
    product: 'WAPPLES',
    demandOrg: '가상기관',
    vendor: '가상상사',
    itemId: `T-${values.id}`,
    itemName: '가상 보안 장비',
    quantity: '2',
    unitPrice: 1_250_000,
    amount: 2_500_000,
    excluded: false,
    excludedAt: null,
    excludedBy: null,
    ...values,
  };
}

const ACTIVE = [row({ id: 1, dlvrReqNo: 'R-1' }), row({ id: 2, dlvrReqNo: 'R-2', product: null })];
const TRASHED = [
  row({
    id: 3,
    dlvrReqNo: 'R-3',
    excluded: true,
    excludedAt: '2026-10-27T01:30:00.000Z',
    excludedBy: 'admin@pentasecurity.com',
  }),
];
const CHOICES = { products: ['WAPPLES', '미등록'], vendors: ['가상상사', '다른상사'] };

function props(extra: Partial<DeliveriesAdminProps> = {}): DeliveriesAdminProps {
  return {
    rows: ACTIVE,
    view: { trash: false, page: 1 },
    total: ACTIVE.length,
    pageCount: 1,
    trashCount: 1,
    choices: CHOICES,
    userId: 'admin-id',
    ...extra,
  };
}

const VALUES: DeliveryValues = {
  dlvrReqDate: '2026-03-01',
  dlvrReqNo: 'R-1',
  changeOrd: '00',
  demandOrg: '가상기관',
  demandOrgType: null,
  businessName: '가상 사업',
  contractNo: null,
  contractType: null,
  vendor: '가상상사',
  vendorType: null,
  vendorAddress: null,
  procurementOffice: null,
  classCode: null,
  className: null,
  itemId: 'T-1',
  itemName: '가상 보안 장비',
  dueDate: null,
  unitPrice: 1_250_000,
  unit: '식',
  quantity: '2',
  amount: 2_500_000,
  totalAmount: 2_500_000,
  collectedOn: null,
};

const DETAIL: DeliveryDetail = {
  id: 1,
  excluded: false,
  values: VALUES,
  history: [
    {
      id: 11,
      before: { amount: 2_000_000 },
      after: { amount: 2_500_000 },
      changedBy: 'admin@pentasecurity.com',
      changedAt: '2026-10-26T00:00:00.000Z',
    },
    {
      id: 10,
      before: { excluded: true },
      after: { excluded: false },
      changedBy: 'other@pentasecurity.com',
      changedAt: '2026-10-25T00:00:00.000Z',
    },
  ],
};

const STALE = {
  ok: false as const,
  error: { code: 'CONFLICT', message: '이미 처리됨', details: { reason: 'stale' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockResolvedValue({ ok: true, data: DETAIL });
});

async function renderAdmin(extra: Partial<DeliveriesAdminProps> = {}) {
  const user = userEvent.setup();
  render(<DeliveriesAdmin {...props(extra)} />);
  const table = await screen.findByRole('table', {
    name: extra.view?.trash ? '휴지통 표' : '납품요구 표',
  });
  return { user, table };
}

describe('URL 코덱 (tab=deliveries)', () => {
  const PARAMS = {
    tab: 'deliveries',
    trash: '1',
    q: ' R-1 ',
    'f.dlvrReqDate.gte': '2026-01-01',
    'f.dlvrReqDate.lte': '2026-06-30',
    'f.product.in': 'WAPPLES,미등록',
    'f.vendor.in': '가상상사',
    'f.demandOrg.has': '기관',
    'f.nope.has': 'x',
    page: '3',
    sort: 'excludedAt',
    dir: 'desc',
    other: 'y',
  };

  it('파싱 → 조회 입력, 직렬화 순서(tab → trash → q → f.* → page → sort·dir)', () => {
    const view = parseAdminDeliveriesView(PARAMS);
    expect(toDeliveryListQuery(view)).toEqual({
      view: 'trash',
      page: 3,
      q: 'R-1',
      sort: { id: 'excludedAt', dir: 'desc' },
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
      products: ['WAPPLES', '미등록'],
      vendors: ['가상상사'],
      demandOrg: { op: 'has', value: '기관' },
    });
    expect(adminDeliveriesHref(view)).toBe(
      '/admin/procurement?tab=deliveries&trash=1&q=R-1&f.dlvrReqDate.gte=2026-01-01&f.dlvrReqDate.lte=2026-06-30' +
        '&f.product.in=WAPPLES%2C%EB%AF%B8%EB%93%B1%EB%A1%9D&f.demandOrg.has=%EA%B8%B0%EA%B4%80' +
        '&f.vendor.in=%EA%B0%80%EC%83%81%EC%83%81%EC%82%AC&page=3&sort=excludedAt&dir=desc',
    );
  });

  it('데이터 선택지를 주면 없는 제품·업체 값이 든 조건은 버린다, 삭제 시각 정렬은 휴지통에서만', () => {
    const view = parseAdminDeliveriesView(
      { 'f.product.in': 'WAPPLES,없는제품', 'f.vendor.in': '없는상사', sort: 'excludedAt' },
      CHOICES,
    );
    // 선택지 밖 값이 섞인 조건은 통째로 버린다 (표 열 필터 공용 규칙 validateIn)
    expect(view.filters).toBeUndefined();
    expect(parseAdminDeliveriesView({ 'f.product.in': 'WAPPLES,미등록' }, CHOICES).filters).toEqual(
      [{ col: 'product', op: 'in', values: ['WAPPLES', '미등록'] }],
    );
    expect(view.sort).toBeUndefined();
  });

  it('조회 상태 정규화: 기본 탭이라 tab 생략, 기본값·모르는 키 생략, 형식 오류 버림', () => {
    expect(normalizeAdminDeliveriesQuery({})).toBe('');
    expect(normalizeAdminDeliveriesQuery({ tab: 'deliveries', page: '1', trash: '0' })).toBe('');
    expect(
      normalizeAdminDeliveriesQuery({ ...PARAMS, 'f.dlvrReqDate.gte': '2026-13-01', q: 'a\u0001' }),
    ).toBe(
      'trash=1&f.dlvrReqDate.lte=2026-06-30&f.product.in=WAPPLES%2C%EB%AF%B8%EB%93%B1%EB%A1%9D' +
        '&f.demandOrg.has=%EA%B8%B0%EA%B4%80&f.vendor.in=%EA%B0%80%EC%83%81%EC%83%81%EC%82%AC&page=3&sort=excludedAt&dir=desc',
    );
  });

  it('값 규칙: 쉼표·공백·수량 표기 차이는 같은 값, 필수 칸·날짜·정수 검증', () => {
    expect(canonicalDeliveryValue('int', '2,500,000')).toBe(
      canonicalDeliveryValue('int', 2_500_000),
    );
    expect(canonicalDeliveryValue('num', '2.50')).toBe(canonicalDeliveryValue('num', '2.5'));
    expect(canonicalDeliveryValue('text', '  a ')).toBe('a');
    const field = (key: string) => DELIVERY_EDIT_FIELDS.find((f) => f.key === key)!;
    expect(parseDeliveryFieldValue(field('itemId'), ' ')).toMatchObject({ ok: false });
    expect(parseDeliveryFieldValue(field('dueDate'), '2026-02-30')).toMatchObject({ ok: false });
    expect(parseDeliveryFieldValue(field('amount'), '1.5')).toMatchObject({ ok: false });
    expect(parseDeliveryFieldValue(field('amount'), '1,500')).toEqual({ ok: true, value: 1500 });
    expect(parseDeliveryFieldValue(field('demandOrg'), '')).toEqual({ ok: true, value: null });
  });
});

describe('실적 관리 표', () => {
  it('서버 한 페이지를 그리고, 금액은 백만원(머리글 단위)·미등록 제품 표시', async () => {
    const { table } = await renderAdmin();
    expect(within(table).getByRole('columnheader', { name: /납품금액 \(백만원\)/ })).toBeVisible();
    const r1 = within(table).getByRole('button', { name: 'R-1-00 편집' }).closest('tr')!;
    expect(within(r1).getByText('2.5')).toHaveAttribute('title', '250만');
    expect(within(table).getByText('미등록')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '휴지통 1' })).toBeInTheDocument();
  });

  it('빠른 필터(server) — 제품 체크는 디바운스 후 URL replace(1페이지), 정렬·페이지는 push', async () => {
    const { user, table } = await renderAdmin({ view: { trash: false, page: 2 }, pageCount: 3 });
    await toggleField(user, '제품', ['미등록'], () => mocks.replace.mock.calls.length > 0);
    expect(mocks.replace).toHaveBeenLastCalledWith(
      '/admin/procurement?tab=deliveries&f.product.in=%EB%AF%B8%EB%93%B1%EB%A1%9D',
    );
    await user.click(within(table).getByRole('button', { name: /납품금액/ }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenLastCalledWith(
        '/admin/procurement?tab=deliveries&sort=amount&dir=asc',
      ),
    );
    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenLastCalledWith('/admin/procurement?tab=deliveries&page=3'),
    );
    await user.type(screen.getByRole('searchbox'), 'R-9{Enter}');
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenLastCalledWith('/admin/procurement?tab=deliveries&q=R-9'),
    );
  });

  it('휴지통으로: 확인 모달 → 서버 액션 → 안내·새로 고침 (window.confirm 을 쓰지 않는다)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    mocks.exclude.mockResolvedValue({ ok: true, data: { id: 1, excluded: true } });
    const { user } = await renderAdmin();
    await user.click(screen.getByRole('button', { name: 'R-1-00 휴지통으로' }));
    const dialog = screen.getByRole('dialog', { name: '휴지통으로 옮기기' });
    expect(dialog).toHaveTextContent('휴지통에서 언제든 되살릴 수 있어요');
    expect(mocks.exclude).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '휴지통으로' }));
    expect(mocks.exclude).toHaveBeenCalledWith({ id: 1 });
    expect(await screen.findByText('R-1-00 을(를) 휴지통으로 옮겼습니다.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('"이미 처리됨": 안내(alert) 후 목록을 새로 고친다', async () => {
    mocks.exclude.mockResolvedValue(STALE);
    const { user } = await renderAdmin();
    await user.click(screen.getByRole('button', { name: 'R-1-00 휴지통으로' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '휴지통으로 옮기기' })).getByRole('button', {
        name: '휴지통으로',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리됨');
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '휴지통으로 옮기기' })).not.toBeInTheDocument(),
    );
  });

  it('다른 오류는 모달 안에 남기고 닫지 않는다', async () => {
    mocks.exclude.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: '요청을 처리하지 못했습니다' },
    });
    const { user } = await renderAdmin();
    await user.click(screen.getByRole('button', { name: 'R-1-00 휴지통으로' }));
    const dialog = screen.getByRole('dialog', { name: '휴지통으로 옮기기' });
    await user.click(within(dialog).getByRole('button', { name: '휴지통으로' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '요청을 처리하지 못했습니다',
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('편집 드로어', () => {
  async function openEditor() {
    const ctx = await renderAdmin();
    await ctx.user.click(screen.getByRole('button', { name: 'R-1-00 편집' }));
    const drawer = await screen.findByRole('dialog', { name: '납품요구 수정 · R-1-00' });
    return { ...ctx, drawer };
  }

  it('전 필드(원본 편집 화면 칸 순서)와 변경 이력 최근 10건을 보인다', async () => {
    const { drawer } = await openEditor();
    expect(mocks.detail).toHaveBeenCalledWith({ id: 1 });
    const form = within(drawer).getByRole('form', { name: '납품요구 수정' });
    expect(
      within(form).getAllByRole('textbox').length +
        form.querySelectorAll('input[type=date]').length,
    ).toBe(DELIVERY_EDIT_FIELDS.length);
    expect(within(drawer).getByLabelText('납품금액')).toHaveValue('2500000');
    expect(within(drawer).getByLabelText('납품요구일자')).toHaveValue('2026-03-01');
    const history = within(drawer).getByRole('region', { name: '변경 이력' });
    expect(history).toHaveTextContent('최근 10건');
    const items = within(history).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(
      '2026-10-26 09:00 · admin@pentasecurity.com · 납품금액: 2,000,000 → 2,500,000',
    );
    expect(items[1]).toHaveTextContent('other@pentasecurity.com · 되살림');
  });

  it('저장: 바뀐 칸을 확인 모달로 보여 준 뒤 values·expected 를 보낸다', async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { id: 1, changed: 1 } });
    const { user, drawer } = await openEditor();
    const amount = within(drawer).getByLabelText('납품금액');
    await user.clear(amount);
    await user.type(amount, '3,000,000');
    await user.click(within(drawer).getByRole('button', { name: '저장' }));
    const confirm = screen.getByRole('dialog', { name: '변경 저장' });
    expect(within(confirm).getByRole('list', { name: '바뀐 칸' })).toHaveTextContent(
      '납품금액: 2500000 → 3000000',
    );
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: '저장' }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const input = mocks.update.mock.calls[0]![0];
    expect(input).toMatchObject({ id: 1, expected: VALUES });
    expect(input.values.amount).toBe('3,000,000');
    expect(input.values.dlvrReqNo).toBe('R-1');
    expect(await screen.findByText('저장했습니다 (1개 칸).')).toBeInTheDocument();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('바뀐 것이 없거나 입력이 틀리면 모달을 열지 않고 칸에 안내한다', async () => {
    const { user, drawer } = await openEditor();
    await user.click(within(drawer).getByRole('button', { name: '저장' }));
    expect(within(drawer).getByRole('alert')).toHaveTextContent('바뀐 내용이 없습니다.');
    const amount = within(drawer).getByLabelText('납품금액');
    await user.clear(amount);
    await user.type(amount, '삼백만');
    await user.click(within(drawer).getByRole('button', { name: '저장' }));
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(within(drawer).getByText('납품금액은(는) 숫자로 입력해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '변경 저장' })).not.toBeInTheDocument();
  });

  it('저장 시 "이미 처리됨"이면 드로어를 닫고 안내 후 새로 고친다', async () => {
    mocks.update.mockResolvedValue(STALE);
    const { user, drawer } = await openEditor();
    const vendor = within(drawer).getByLabelText('납품업체명');
    await user.type(vendor, '2');
    await user.click(within(drawer).getByRole('button', { name: '저장' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '변경 저장' })).getByRole('button', {
        name: '저장',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리됨');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /납품요구 수정/ })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('여는 사이 휴지통으로 옮겨졌으면(상세 excluded) 바로 "이미 처리됨"', async () => {
    mocks.detail.mockResolvedValue({ ok: true, data: { ...DETAIL, excluded: true } });
    const { user } = await renderAdmin();
    await user.click(screen.getByRole('button', { name: 'R-1-00 편집' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리됨');
  });
});

describe('휴지통', () => {
  it('하위 화면 전환은 ?tab=deliveries&trash=1 push', async () => {
    const { user } = await renderAdmin({ view: { trash: false, page: 2, q: 'x' } });
    await user.click(screen.getByRole('radio', { name: '휴지통 1' }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenLastCalledWith('/admin/procurement?tab=deliveries&trash=1'),
    );
  });

  it('삭제 시각·삭제한 사람 → 되살리기 확인 모달 → 서버 액션 → refresh', async () => {
    mocks.restore.mockResolvedValue({ ok: true, data: { id: 3, excluded: false } });
    const { user, table } = await renderAdmin({ rows: TRASHED, view: { trash: true, page: 1 } });
    expect(screen.getByRole('radio', { name: '휴지통 1' })).toBeChecked();
    const trashed = within(table).getByRole('button', { name: 'R-3-00 되살리기' }).closest('tr')!;
    expect(trashed).toHaveTextContent('2026-10-27 10:30');
    expect(trashed).toHaveTextContent('admin@pentasecurity.com');
    await user.click(within(trashed).getByRole('button', { name: 'R-3-00 되살리기' }));
    const dialog = screen.getByRole('dialog', { name: '되살리기' });
    await user.click(within(dialog).getByRole('button', { name: '되살리기' }));
    expect(mocks.restore).toHaveBeenCalledWith({ id: 3 });
    expect(await screen.findByText('R-3-00 을(를) 되살렸습니다.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('비어 있으면 원본과 같은 안내 문구', async () => {
    await renderAdmin({ rows: [], total: 0, trashCount: 0, view: { trash: true, page: 1 } });
    expect(screen.getByRole('radio', { name: '휴지통' })).toBeChecked();
    expect(
      await screen.findByText(
        '휴지통이 비어 있어요. 삭제한 납품요구는 여기로 옮겨지고, 언제든 되살릴 수 있어요.',
      ),
    ).toBeInTheDocument();
  });
});
