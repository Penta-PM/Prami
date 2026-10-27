import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * 조달이 통합 (jodari-stage1-3 §공통·DB-1). 조달 데이터는 Postgres 스키마 `procurement` 에 원래 테이블 이름 그대로 둔다
 * (Prami `public.items` 와 충돌 없음, 외부 수집기 SQL 무수정 — search_path = procurement).
 * TS 이름은 `procurement*` 접두로 Prami 테이블과 구분한다.
 */
export const procurementSchema = pgSchema('procurement');
