/**
 * 감사 로그 표 서버 정렬 화이트리스트 (#32 스펙 §3) — 클라이언트·서버 공용(서버 모듈을 import 하지 않는다).
 * '변경 전/후'(jsonb)는 정렬하지 않는다 (스펙 §2).
 */
export const AUDIT_SORT_IDS = ['createdAt', 'actor', 'action', 'target', 'ip', 'result'] as const;
export type AuditSortId = (typeof AUDIT_SORT_IDS)[number];
