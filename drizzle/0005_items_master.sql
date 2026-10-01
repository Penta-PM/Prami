CREATE TYPE "public"."item_source" AS ENUM('master', 'stub');--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "source_files" jsonb;--> statement-breakpoint
ALTER TABLE "policy_apply_runs" ADD COLUMN "item_merge" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "category_major_raw" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_kind_rule" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "base_unit" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "erp_registered_on" date;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "erp_modified_on" date;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "source" "item_source" DEFAULT 'master' NOT NULL;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "category_major_raw" text;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "item_status" "item_status";--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "item_kind" "item_kind";--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "item_kind_rule" text;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "base_unit" text;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "erp_registered_on" date;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "erp_modified_on" date;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "source_file" text;--> statement-breakpoint
ALTER TABLE "stg_items" ADD COLUMN "file_row" integer;--> statement-breakpoint
-- PRAMI-003 §4.2.8 백필: 판매단가에만 있던 품번(raw.stub=true)과, 포맷 확정 전 최소 계약으로 들어온 행 중 종류·상태·대분류가 빈 행은 stub.
-- 품목 5파일 적용 시 master 로 다시 채워진다. 이 마이그레이션은 추가형(expand)이라 직전 앱 버전(da1b186)의 조회와 호환된다.
UPDATE "items" SET "source" = 'stub' WHERE coalesce("raw"->>'stub', 'false') = 'true' OR "item_kind" IS NULL OR "item_status" IS NULL OR "category_major" IS NULL;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_master_required_ck" CHECK ("items"."source" <> 'master' or ("items"."item_kind" is not null and "items"."item_status" is not null and "items"."category_major" is not null));