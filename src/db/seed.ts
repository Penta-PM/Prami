import { sql } from 'drizzle-orm';

import { dbHostOf, isLocalDbHost } from '@/lib/db-host';

import type { DbHandle } from './index';
import { auditLogs, notices, users, type User } from './schema';
import { withTransaction, type Tx } from './tx';

/**
 * 픽스처 사용자 (AC-02). ADMIN_EMAILS 부트스트랩과는 별개의 QA 전용 계정이며,
 * PR-2 의 AUTH_TEST_MODE Credentials 로그인 대상이다. 도메인은 ALLOWED_EMAIL_DOMAINS 기본값을 따른다.
 */
export const SEED_USERS = [
  {
    email: 'fixture-admin@pentasecurity.com',
    name: '픽스처 관리자',
    department: '가격정책팀',
    role: 'ADMIN',
  },
  {
    email: 'fixture-user@pentasecurity.com',
    name: '픽스처 사용자',
    department: 'WAPPLES 사업부',
    role: 'USER',
  },
] as const satisfies ReadonlyArray<Pick<User, 'email' | 'name' | 'department' | 'role'>>;

/** 공지 샘플. id 를 고정해 재실행 시 갱신(upsert)되도록 한다 */
export const SEED_NOTICES = [
  {
    id: '11111111-0000-4000-8000-000000000001',
    title: 'Prami 가격정책 통합 관리 플랫폼 오픈 안내',
    body: '판매단가·원가·파츠·견적 정보를 한곳에서 조회합니다. 문의는 가격정책팀으로 주세요.',
    isImportant: true,
    publishedAt: '2026-09-01',
  },
  {
    id: '11111111-0000-4000-8000-000000000002',
    title: '2026년 하반기 가격정책 적용 일정',
    body: 'ERP 판매단가 파일 임포트 후 적용 일정과 확인 방법을 안내합니다.',
    isImportant: false,
    publishedAt: '2026-09-10',
  },
  {
    id: '11111111-0000-4000-8000-000000000003',
    title: '견적 계산기 사용 가이드',
    body: 'STEP1~6 흐름과 장바구니, 견적 저장 기능 사용법을 정리했습니다.',
    isImportant: false,
    publishedAt: '2026-09-15',
  },
] as const;

export const SEED_ACTOR_LABEL = 'seed';
export const SEED_AUDIT_ACTION = 'user.seed';

export type SeedResult = {
  users: Array<Pick<User, 'id' | 'email' | 'role'>>;
  noticeCount: number;
  auditLogCount: number;
};

async function upsertUsers(tx: Tx): Promise<User[]> {
  return tx
    .insert(users)
    .values(SEED_USERS.map((user) => ({ ...user, createdVia: 'admin' as const })))
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: sql`excluded.name`,
        department: sql`excluded.department`,
        role: sql`excluded.role`,
        status: 'active',
        updatedAt: new Date(),
      },
    })
    .returning();
}

async function writeSeedAudit(tx: Tx, seeded: User[]): Promise<number> {
  const rows = await tx
    .insert(auditLogs)
    .values(
      seeded.map((user) => ({
        actorLabel: SEED_ACTOR_LABEL,
        action: SEED_AUDIT_ACTION,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        after: { email: user.email, role: user.role, createdVia: user.createdVia },
        reason: 'pnpm seed 픽스처 계정 생성/갱신',
        result: 'success' as const,
      })),
    )
    .returning({ id: auditLogs.id });
  return rows.length;
}

async function upsertNotices(tx: Tx, author: User): Promise<number> {
  const rows = await tx
    .insert(notices)
    .values(
      SEED_NOTICES.map((notice) => ({
        ...notice,
        authorName: author.name,
        authorUserId: author.id,
      })),
    )
    .onConflictDoUpdate({
      target: notices.id,
      set: {
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        isImportant: sql`excluded.is_important`,
        publishedAt: sql`excluded.published_at`,
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: notices.id });
  return rows.length;
}

/** seed 를 허용하는 표식 (PRAMI-003 §4.9.3 L2) — CI·E2E·격리 DB 만 설정한다 */
export const ALLOW_SEED_ENV = 'PRAMI_ALLOW_SEED';

export class SeedTargetError extends Error {
  constructor(readonly reason: SeedTargetViolation) {
    super(SEED_TARGET_MESSAGES[reason]);
    this.name = 'SeedTargetError';
  }
}

export type SeedTargetViolation = 'production' | 'vercel' | 'neon' | 'remote_host' | 'not_allowed';

const SEED_TARGET_MESSAGES: Record<SeedTargetViolation, string> = {
  production: 'NODE_ENV=production 에서는 seed 를 실행할 수 없습니다',
  vercel: 'VERCEL_ENV 가 있는 환경에서는 seed 를 실행할 수 없습니다',
  neon: 'DB_DRIVER=neon 대상에는 seed 를 실행할 수 없습니다',
  remote_host:
    'DATABASE_URL 호스트가 로컬 목록(localhost·127.0.0.1·::1·postgres·db) 밖입니다 — seed 는 원격 DB 에 실행할 수 없습니다',
  not_allowed: `로컬 DB 라도 ${ALLOW_SEED_ENV}=1 일 때만 seed 를 실행합니다 (CI·E2E·격리 DB 전용 — 로컬 :3000 DB 금지)`,
};

/**
 * seed 대상 판정 (PRAMI-003 §4.3.4·§4.9.3 L2). 원격 조건이면 우회 플래그 없이 거부, 로컬이어도 PRAMI_ALLOW_SEED=1 이 필요하다.
 * 핸들이 있으면 실제 연결(드라이버·URL)을 기준으로, 없으면 환경변수로 판정한다.
 */
export function seedTargetViolation(
  source: Record<string, string | undefined>,
  target?: Pick<DbHandle, 'driver' | 'databaseUrl'>,
): SeedTargetViolation | null {
  if (source.NODE_ENV === 'production') return 'production';
  if ((source.VERCEL_ENV ?? '').trim() !== '') return 'vercel';
  const driver = target?.driver ?? source.DB_DRIVER ?? 'pglite';
  if (driver === 'neon') return 'neon';
  const url = target ? target.databaseUrl : source.DATABASE_URL;
  if (driver !== 'pglite' && !isLocalDbHost(dbHostOf(url))) return 'remote_host';
  if ((source[ALLOW_SEED_ENV] ?? '').trim() !== '1') return 'not_allowed';
  return null;
}

/** 위반이면 DB 에 접근하기 전에 throw 한다 (스크립트·함수 양쪽 진입점) */
export function assertSeedTargetIsLocal(
  source: Record<string, string | undefined> = process.env,
  target?: Pick<DbHandle, 'driver' | 'databaseUrl'>,
): void {
  const violation = seedTargetViolation(source, target);
  if (violation) throw new SeedTargetError(violation);
}

/**
 * 시드 전체를 한 트랜잭션으로 실행한다 (감사 로그는 변경과 같은 배치 — §4.2 원칙 4).
 * 재실행해도 안전하다: 사용자·공지는 upsert, 감사 로그는 실행마다 append.
 * 원격·미허용 대상이면 DB 접근 없이 SeedTargetError (PRAMI-003 §4.3.4, AC-323·333).
 */
export async function seedDatabase(
  handle: DbHandle,
  source: Record<string, string | undefined> = process.env,
): Promise<SeedResult> {
  assertSeedTargetIsLocal(source, handle);
  return withTransaction(async (tx) => {
    const seededUsers = await upsertUsers(tx);
    const admin = seededUsers.find((user) => user.role === 'ADMIN');
    if (!admin) throw new Error('픽스처 ADMIN 생성에 실패했습니다');
    const auditLogCount = await writeSeedAudit(tx, seededUsers);
    const noticeCount = await upsertNotices(tx, admin);
    return {
      users: seededUsers.map(({ id, email, role }) => ({ id, email, role })),
      noticeCount,
      auditLogCount,
    };
  }, handle);
}
