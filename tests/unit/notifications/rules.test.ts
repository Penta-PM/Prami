// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_LIST_LIMIT, NOTIFICATION_TYPES } from '@/features/notifications/types';
import { hasPermission, PERMISSION_GROUPS, PERMISSIONS } from '@/lib/constants/permissions';
import { notificationHref } from '@/server/notifications/href';
import { clampLimit } from '@/server/notifications/queries';
import {
  NOTIFICATION_REQUIRED_PERMISSION,
  notificationContent,
} from '@/server/notifications/types';

/** #31 §2 민감정보 규칙(type → requiredPermission 고정) · §4 notificationHref 내부 경로 3종 */
const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const ALLOWED =
  /^(\/notices\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/pricing|\/settings)$/;

describe('NOTIFICATION_REQUIRED_PERMISSION', () => {
  it('표를 고정한다 — type 을 추가하면 이 테스트도 함께 고친다', () => {
    expect(NOTIFICATION_REQUIRED_PERMISSION).toEqual({
      'notice.created': 'notice.read',
      'policy.applied': 'pricing.read',
      'user.role_changed': 'notification.self',
    });
    expect(Object.keys(NOTIFICATION_REQUIRED_PERMISSION).sort()).toEqual(
      [...NOTIFICATION_TYPES].sort(),
    );
  });

  it('어떤 type 도 원가 계열 권한을 요구하지 않고, 지금 type 은 전부 USER 가 받을 수 있다', () => {
    for (const type of NOTIFICATION_TYPES) {
      const permission = NOTIFICATION_REQUIRED_PERMISSION[type];
      expect(permission.startsWith('cost.')).toBe(false);
      expect(permission in PERMISSIONS).toBe(true);
      expect(hasPermission('USER', permission)).toBe(true);
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
  });

  it("권한 키 notification.self 는 USER·ADMIN, 권한 표에 '내 알림' 행", () => {
    expect(PERMISSIONS['notification.self']).toEqual(['USER', 'ADMIN']);
    expect(PERMISSION_GROUPS.find((group) => group.keys.includes('notification.self'))?.label).toBe(
      '내 알림',
    );
  });
});

describe('notificationHref', () => {
  it('내부 경로 3종만 돌려준다', () => {
    expect(notificationHref('notice.created', UUID)).toBe(`/notices/${UUID}`);
    expect(notificationHref('notice.created', UUID.toUpperCase())).toBe(`/notices/${UUID}`);
    expect(notificationHref('policy.applied', null)).toBe('/pricing');
    expect(notificationHref('policy.applied', 'anything')).toBe('/pricing');
    expect(notificationHref('user.role_changed', UUID)).toBe('/settings');
  });

  it('ref 주입(경로 이탈·외부 URL·스킴·개행)으로 다른 경로를 만들 수 없다', () => {
    const attacks = [
      '../x',
      '../../admin',
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      `${UUID}/../../x`,
      `${UUID}?next=https://evil`,
      `${UUID}\n`,
      ` ${UUID}`,
      '',
      null,
      undefined,
    ];
    for (const ref of attacks) {
      expect(notificationHref('notice.created', ref)).toBeNull();
      for (const type of NOTIFICATION_TYPES) {
        const href = notificationHref(type, ref);
        if (href !== null) expect(href).toMatch(ALLOWED);
      }
    }
    expect(notificationHref('unknown' as never, UUID)).toBeNull();
  });
});

describe('notificationContent', () => {
  it('policy.applied 본문은 반영 건수만 (금액 없음)', () => {
    expect(notificationContent.policyApplied(1234)).toEqual({
      title: '가격정책이 갱신되었습니다',
      body: '반영 1234건',
    });
    expect(notificationContent.policyApplied(Number.NaN).body).toBe('반영 0건');
    expect(notificationContent.policyApplied(3.7).body).toBe('반영 3건');
  });

  it('notice.created 는 "새 공지: {제목}" 이고 200자를 넘지 않는다', () => {
    expect(notificationContent.noticeCreated('점검 안내')).toEqual({
      title: '새 공지: 점검 안내',
      body: null,
    });
    const long = notificationContent.noticeCreated('가'.repeat(300)).title;
    expect(Array.from(long)).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('user.role_changed 는 역할 라벨', () => {
    expect(notificationContent.roleChanged('ADMIN').title).toBe('역할이 관리자로 변경되었습니다');
    expect(notificationContent.roleChanged('USER').title).toBe('역할이 사용자로 변경되었습니다');
  });
});

describe('clampLimit', () => {
  it('없거나 잘못되면 20, 1..50 으로 자른다', () => {
    expect(clampLimit(null)).toBe(NOTIFICATION_LIST_LIMIT);
    expect(clampLimit('')).toBe(20);
    expect(clampLimit('abc')).toBe(20);
    expect(clampLimit('0')).toBe(1);
    expect(clampLimit('-5')).toBe(1);
    expect(clampLimit('7.9')).toBe(7);
    expect(clampLimit('999')).toBe(50);
    expect(clampLimit(50)).toBe(50);
  });
});
