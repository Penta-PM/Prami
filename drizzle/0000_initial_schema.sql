-- PRAMI-001 PR-1 초기 스키마 (스펙 §4.3). 확장은 테이블 생성 전에 필요하므로 drizzle-kit 산출물 앞에 수동으로 둔다:
--   citext = users.email, pg_trgm = sales_prices.item_name GIN 인덱스, pgcrypto = gen_random_uuid() (PG13+ 내장이지만 스펙 §4.1 에 따라 명시)
CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."apply_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('success', 'denied', 'error');--> statement-breakpoint
CREATE TYPE "public"."created_via" AS ENUM('bootstrap', 'auto', 'admin');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('sales_price', 'item_master', 'material_cost', 'part_mapping');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('parsed', 'failed', 'applied', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('본품', '파츠', '결합형', '서비스', '기타');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('임시', '폐기', '사용');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('운영중', '미사용');--> statement-breakpoint
CREATE TYPE "public"."quote_line_kind" AS ENUM('item', 'group');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'saved');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('erp', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" "inet",
	"user_agent" text,
	"result" "audit_result" DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "import_kind" NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_ref" text,
	"header_row_index" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"status" "import_status" DEFAULT 'parsed' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policy_apply_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_batch_id" uuid NOT NULL,
	"item_batch_id" uuid,
	"sales_reused" boolean DEFAULT false NOT NULL,
	"item_reused" boolean DEFAULT false NOT NULL,
	"status" "apply_run_status" DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"run_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_code" text PRIMARY KEY NOT NULL,
	"item_name" text NOT NULL,
	"category_major" text,
	"category_mid" text,
	"category_minor" text,
	"item_status" "item_status",
	"item_status_raw" text,
	"item_kind" "item_kind",
	"raw" jsonb,
	"import_batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "material_costs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_code" text NOT NULL,
	"material_name" text NOT NULL,
	"spec" text,
	"unit" text NOT NULL,
	"price_type" text NOT NULL,
	"price_category" text NOT NULL,
	"currency" char(3) NOT NULL,
	"unit_cost" numeric(18, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"is_final_source" boolean NOT NULL,
	"remark" text,
	"applies_to_all_customers" boolean NOT NULL,
	"source" "source_kind" NOT NULL,
	"import_batch_id" uuid,
	"series_key" text GENERATED ALWAYS AS ("material_code" || '|' || "price_type" || '|' || "price_category" || '|' || "currency") STORED NOT NULL,
	"effective_to" date,
	"is_latest_in_series" boolean DEFAULT false NOT NULL,
	"operation_status" "operation_status" DEFAULT '미사용' NOT NULL,
	"product_family" text,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_name" text NOT NULL,
	"author_user_id" uuid,
	"is_important" boolean DEFAULT false NOT NULL,
	"published_at" date DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "part_mappings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"model_item_code" text NOT NULL,
	"part_item_code" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"import_batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "part_mappings_model_part_uq" UNIQUE("model_item_code","part_item_code")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" "quote_line_kind" NOT NULL,
	"item_code" text,
	"group_id" uuid,
	"price_type" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"options" jsonb,
	"discount_rate" numeric(5, 1) DEFAULT '0' NOT NULL,
	"pre_discount" numeric(18, 2) NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	CONSTRAINT "quote_lines_quote_line_no_uq" UNIQUE("quote_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "quote_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_no" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"product_family" text,
	"title" text NOT NULL,
	"summary" text,
	"total_amount" numeric(18, 0),
	"currency" char(3),
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "quotes_quote_no_unique" UNIQUE("quote_no")
);
--> statement-breakpoint
CREATE TABLE "sales_prices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"product_family" text NOT NULL,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"spec" text,
	"unit" text NOT NULL,
	"price_type" text,
	"price_category" text NOT NULL,
	"currency" char(3) NOT NULL,
	"has_core_price" boolean NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"remark" text,
	"effective_from" date NOT NULL,
	"applies_to_all_customers" boolean NOT NULL,
	"is_final_source" boolean NOT NULL,
	"base_core_count" integer NOT NULL,
	"unit_price_per_core" numeric(18, 2) NOT NULL,
	"customer_code" text NOT NULL,
	"customer_no" text,
	"customer_name" text,
	"source" "source_kind" NOT NULL,
	"import_batch_id" uuid,
	"series_key" text GENERATED ALWAYS AS ("item_code" || '|' || coalesce("price_type", '') || '|' || "price_category" || '|' || "currency" || '|' || "customer_code") STORED NOT NULL,
	"effective_to" date,
	"is_latest_in_series" boolean DEFAULT false NOT NULL,
	"operation_status" "operation_status" DEFAULT '미사용' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "solution_group_items" (
	"group_id" uuid NOT NULL,
	"item_code" text NOT NULL,
	"default_qty" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "solution_group_items_group_id_item_code_pk" PRIMARY KEY("group_id","item_code")
);
--> statement-breakpoint
CREATE TABLE "solution_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_family" text NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stg_items" (
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"category_major" text,
	"category_mid" text,
	"category_minor" text,
	"item_status_raw" text,
	"raw" jsonb,
	CONSTRAINT "stg_items_batch_id_row_index_pk" PRIMARY KEY("batch_id","row_index")
);
--> statement-breakpoint
CREATE TABLE "stg_sales_prices" (
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"source_id" integer NOT NULL,
	"product_family" text NOT NULL,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"spec" text,
	"unit" text NOT NULL,
	"price_type" text,
	"price_category" text NOT NULL,
	"currency" char(3) NOT NULL,
	"has_core_price" boolean NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"remark" text,
	"effective_from" date NOT NULL,
	"applies_to_all_customers" boolean NOT NULL,
	"is_final_source" boolean NOT NULL,
	"base_core_count" integer NOT NULL,
	"unit_price_per_core" numeric(18, 2) NOT NULL,
	"customer_code" text NOT NULL,
	"customer_no" text,
	"customer_name" text,
	CONSTRAINT "stg_sales_prices_batch_id_row_index_pk" PRIMARY KEY("batch_id","row_index")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"department" text,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"google_sub" text,
	"avatar_url" text,
	"last_login_at" timestamp with time zone,
	"created_via" "created_via" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_apply_runs" ADD CONSTRAINT "policy_apply_runs_sales_batch_id_import_batches_id_fk" FOREIGN KEY ("sales_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_apply_runs" ADD CONSTRAINT "policy_apply_runs_item_batch_id_import_batches_id_fk" FOREIGN KEY ("item_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_apply_runs" ADD CONSTRAINT "policy_apply_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_costs" ADD CONSTRAINT "material_costs_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_costs" ADD CONSTRAINT "material_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_costs" ADD CONSTRAINT "material_costs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_mappings" ADD CONSTRAINT "part_mappings_model_item_code_items_item_code_fk" FOREIGN KEY ("model_item_code") REFERENCES "public"."items"("item_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_mappings" ADD CONSTRAINT "part_mappings_part_item_code_items_item_code_fk" FOREIGN KEY ("part_item_code") REFERENCES "public"."items"("item_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_mappings" ADD CONSTRAINT "part_mappings_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_mappings" ADD CONSTRAINT "part_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_shares" ADD CONSTRAINT "quote_shares_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_shares" ADD CONSTRAINT "quote_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_prices" ADD CONSTRAINT "sales_prices_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_prices" ADD CONSTRAINT "sales_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_prices" ADD CONSTRAINT "sales_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_group_items" ADD CONSTRAINT "solution_group_items_group_id_solution_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."solution_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_group_items" ADD CONSTRAINT "solution_group_items_item_code_items_item_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("item_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_groups" ADD CONSTRAINT "solution_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_items" ADD CONSTRAINT "stg_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_sales_prices" ADD CONSTRAINT "stg_sales_prices_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_kind_sha256_uq" ON "import_batches" USING btree ("kind","file_sha256");--> statement-breakpoint
CREATE INDEX "import_batches_kind_status_idx" ON "import_batches" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "policy_apply_runs_status_started_idx" ON "policy_apply_runs" USING btree ("status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_category_idx" ON "items" USING btree ("category_major","category_mid","category_minor");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("item_status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_costs_series_effective_uq" ON "material_costs" USING btree ("series_key","effective_from") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "material_costs_material_code_idx" ON "material_costs" USING btree ("material_code");--> statement-breakpoint
CREATE INDEX "material_costs_family_effective_idx" ON "material_costs" USING btree ("product_family","effective_from");--> statement-breakpoint
CREATE INDEX "notices_published_idx" ON "notices" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "part_mappings_model_idx" ON "part_mappings" USING btree ("model_item_code");--> statement-breakpoint
CREATE INDEX "quotes_owner_idx" ON "quotes" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sales_prices_series_effective_uq" ON "sales_prices" USING btree ("series_key","effective_from") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sales_prices_item_code_idx" ON "sales_prices" USING btree ("item_code");--> statement-breakpoint
CREATE INDEX "sales_prices_family_effective_idx" ON "sales_prices" USING btree ("product_family","effective_from");--> statement-breakpoint
CREATE INDEX "sales_prices_series_effective_idx" ON "sales_prices" USING btree ("series_key","effective_from");--> statement-breakpoint
CREATE INDEX "sales_prices_operation_status_idx" ON "sales_prices" USING btree ("operation_status");--> statement-breakpoint
CREATE INDEX "sales_prices_item_name_trgm_idx" ON "sales_prices" USING gin ("item_name" gin_trgm_ops);--> statement-breakpoint
CREATE VIEW "public"."v_category_options" AS (select distinct "category_major", "category_mid", "category_minor" from "items" where "items"."category_major" is not null);
--> statement-breakpoint
-- audit_logs 는 append-only (§4.3.10). 앱 DB 롤의 UPDATE/DELETE 권한 회수는 배포 단계(PR-11)에서 처리하고,
-- 드라이버·환경과 무관하게 동작하는 트리거로 먼저 강제한다.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = format('audit_logs is append-only: %s is not allowed', TG_OP), ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only_trg BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
