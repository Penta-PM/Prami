import { STATUS_ORDERS } from '@/lib/table/compare';
import type { ColumnFilterDef } from '@/lib/table/filter';

/**
 * 사용자 표 URL 상태 화이트리스트 (page-state-memory §2.2) — 표(클라이언트)와 저장·복원 정규화(서버)가 같은 목록을 쓴다.
 * 키 순서 = 열 순서 = URL·칩 순서.
 */
export const USER_STATUS_LABELS = { active: '활성', inactive: '비활성' } as const;

export const USERS_FILTER_DEFS = {
  name: { kind: 'text' },
  email: { kind: 'text' },
  department: { kind: 'text' },
  role: { kind: 'enum', options: STATUS_ORDERS.role.map((role) => ({ value: role, label: role })) },
  status: {
    kind: 'enum',
    options: STATUS_ORDERS.userStatus.map((status) => ({
      value: status,
      label: USER_STATUS_LABELS[status],
    })),
  },
  lastLoginAt: { kind: 'date' },
} as const satisfies Record<string, ColumnFilterDef>;

/** 정렬 가능한 열 (관리 열 제외) */
export const USERS_SORT_IDS = [
  'name',
  'email',
  'department',
  'role',
  'status',
  'lastLoginAt',
] as const;
