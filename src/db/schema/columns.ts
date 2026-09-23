import { customType, timestamp } from 'drizzle-orm/pg-core';

/** 대소문자 무시 텍스트 (citext 확장). users.email 에 사용 (§4.3.10) */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/** 공통 컬럼: created_at timestamptz default now(), updated_at timestamptz (§4.3 서두) */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).$onUpdate(() => new Date()),
};

/** soft delete 표식 (감사 로그 대응) */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
