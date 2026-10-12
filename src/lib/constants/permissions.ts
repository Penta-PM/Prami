/**
 * 권한 매트릭스 (§4.6). 역할은 DB enum 이지만 권한은 이 상수 한 곳에서 관리한다.
 * 서버 경계(requirePermission)와 화면(권한 표, 관리자 메뉴 노출)이 같은 상수를 쓴다.
 */
export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const PERMISSIONS = {
  'pricing.read': ['USER', 'ADMIN'],
  'calculator.use': ['USER', 'ADMIN'],
  'notice.read': ['USER', 'ADMIN'],
  search: ['USER', 'ADMIN'],
  'chat.use': ['USER', 'ADMIN'],
  /** PRAMI-002 §4.11: 본인 LLM 키·기본 모델 (대상은 항상 본인) */
  'settings.self': ['USER', 'ADMIN'],
  /** #31 앱 내 알림: 본인 알림 조회·읽음 처리 (대상은 항상 본인) */
  'notification.self': ['USER', 'ADMIN'],
  'pricing.write': ['ADMIN'],
  'notice.write': ['ADMIN'],
  'cost.read': ['ADMIN'],
  'cost.write': ['ADMIN'],
  'parts.write': ['ADMIN'],
  'groups.write': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'audit.read': ['ADMIN'],
  'system.settings': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type PermissionKey = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | null | undefined, key: PermissionKey): boolean {
  if (!role) return false;
  return (PERMISSIONS[key] as readonly Role[]).includes(role);
}

/** 관리자 영역(/admin/*) 진입에 필요한 최소 권한. proxy 1차 방어가 쓴다 */
export function canAccessAdminArea(role: Role | null | undefined): boolean {
  return role === 'ADMIN';
}

export type PermissionGroup = { label: string; keys: readonly PermissionKey[] };

/** 사용자·권한 화면의 권한 표 행 (디자인 permissionRows 라벨 순서). 표시 값은 PERMISSIONS 에서 계산한다 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { label: '가격정책 조회', keys: ['pricing.read'] },
  { label: '견적 계산기 / 순매출 계산기', keys: ['calculator.use'] },
  { label: '검색 / 공지사항 / 챗봇', keys: ['search', 'notice.read', 'chat.use'] },
  { label: '사용자 설정 (본인 LLM 키 · 기본 모델)', keys: ['settings.self'] },
  { label: '내 알림', keys: ['notification.self'] },
  { label: '가격정책 등록 · 수정 · 삭제', keys: ['pricing.write'] },
  { label: '원가 조회 · 등록 · 수정 · 삭제', keys: ['cost.read', 'cost.write'] },
  { label: '파츠 · 솔루션 그룹 관리', keys: ['parts.write', 'groups.write'] },
  { label: '사용자 · 권한 관리', keys: ['users.manage'] },
  { label: '감사 로그 · 시스템 설정', keys: ['audit.read', 'system.settings'] },
];

/** 그룹의 모든 권한을 가진 경우만 허용으로 표시한다 */
export function groupAllowed(role: Role, group: PermissionGroup): boolean {
  return group.keys.every((key) => hasPermission(role, key));
}

export const ROLE_LABELS: Record<Role, string> = { ADMIN: '관리자', USER: '사용자' };
