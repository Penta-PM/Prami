CREATE SCHEMA "procurement";
--> statement-breakpoint
CREATE TABLE "procurement"."app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement"."bid_keywords" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product" text NOT NULL,
	"keyword" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_keywords_product_keyword_key" UNIQUE("product","keyword"),
	CONSTRAINT "bid_keywords_product_check" CHECK ("procurement"."bid_keywords"."product" in ('WAPPLES', 'D.AMO', 'iSIGN', '제외')),
	CONSTRAINT "bid_keywords_keyword_check" CHECK (length(trim("procurement"."bid_keywords"."keyword")) > 0)
);
--> statement-breakpoint
CREATE TABLE "procurement"."bid_notices" (
	"bid_no" text PRIMARY KEY NOT NULL,
	"bid_ord" text DEFAULT '000' NOT NULL,
	"products" text[] DEFAULT '{}' NOT NULL,
	"title" text NOT NULL,
	"business_type" text,
	"order_org" text,
	"demand_org" text,
	"posted_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"budget" bigint,
	"est_price" bigint,
	"notice_status" text,
	"detail_url" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"fit_grade" text,
	"fit_score" integer,
	"fit_reasons" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "bid_notices_fit_grade_check" CHECK ("procurement"."bid_notices"."fit_grade" in ('상', '중', '하'))
);
--> statement-breakpoint
CREATE TABLE "procurement"."deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dlvr_req_no" text NOT NULL,
	"item_id" text NOT NULL,
	"change_ord" text DEFAULT '00' NOT NULL,
	"dlvr_req_date" date,
	"demand_org" text,
	"demand_org_type" text,
	"business_name" text,
	"contract_no" text,
	"contract_type" text,
	"vendor" text,
	"vendor_type" text,
	"vendor_address" text,
	"procurement_office" text,
	"class_code" text,
	"class_name" text,
	"item_name" text,
	"due_date" date,
	"unit_price" bigint,
	"unit" text,
	"quantity" numeric,
	"amount" bigint,
	"total_amount" bigint,
	"collected_on" date,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	CONSTRAINT "deliveries_dlvr_req_no_item_id_change_ord_key" UNIQUE("dlvr_req_no","item_id","change_ord")
);
--> statement-breakpoint
CREATE TABLE "procurement"."delivery_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"delivery_id" bigint,
	"before" jsonb,
	"after" jsonb,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement"."item_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_pk" bigint,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement"."items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"product" text NOT NULL,
	"product_group" text,
	"detail_category" text,
	"manufacturer" text,
	"item_name" text,
	"registered_on" date,
	"collected_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_item_id_product_key" UNIQUE("item_id","product"),
	CONSTRAINT "items_status_check" CHECK ("procurement"."items"."status" in ('pending', 'active', 'excluded')),
	CONSTRAINT "items_source_check" CHECK ("procurement"."items"."source" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "procurement"."job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" jsonb,
	CONSTRAINT "job_runs_status_check" CHECK ("procurement"."job_runs"."status" in ('running', 'ok', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "procurement"."delivery_changes" ADD CONSTRAINT "delivery_changes_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "procurement"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement"."item_changes" ADD CONSTRAINT "item_changes_item_pk_fkey" FOREIGN KEY ("item_pk") REFERENCES "procurement"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bid_notices_posted_idx" ON "procurement"."bid_notices" USING btree ("posted_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "deliveries_item_id_idx" ON "procurement"."deliveries" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "deliveries_date_idx" ON "procurement"."deliveries" USING btree ("dlvr_req_date");--> statement-breakpoint
CREATE INDEX "items_item_id_idx" ON "procurement"."items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "procurement"."items" USING btree ("status","product");--> statement-breakpoint
-- ── 손 작성 구간 (drizzle-kit 이 관리하지 않음 — 트리거 함수·트리거·뷰 3개) ──
-- 조달이 원본 DDL 과 같은 규칙. 뷰는 원본의 `*`·`d.*` 를 열 이름으로 명시했다(열 순서 동일). TS 는 pgView(...).existing().
-- 원본의 Supabase 전용 객체(RLS·auth.jwt() 이력 트리거·Realtime·Vault·pg_cron)는 옮기지 않는다.
-- items 쓰기마다 updated_at 갱신 + iSIGN 세부분류 → product_group 계산 (외부 수집기가 넣는 행에도 같은 규칙, 옛 번호 이름도 인식)
CREATE OR REPLACE FUNCTION "procurement"."items_before_write"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" := now();
  IF NEW."product" = 'iSIGN' THEN
    NEW."product_group" := CASE
      WHEN NEW."detail_category" = 'SSO' THEN 'SSO'
      WHEN NEW."detail_category" = 'PKI' THEN 'WA'
      WHEN NEW."detail_category" IN ('OTP', '생체인증', 'PIN', '간편인증', '인증서중계') THEN 'PASS'
      WHEN NEW."detail_category" = 'OS 로그온' THEN 'OS 로그온'
      WHEN coalesce(NEW."detail_category", '') LIKE '01%' THEN 'SSO'
      WHEN coalesce(NEW."detail_category", '') LIKE '02%' THEN 'WA'
      WHEN coalesce(NEW."detail_category", '') LIKE '03%' THEN 'PASS'
      WHEN coalesce(NEW."detail_category", '') LIKE '04%' THEN 'OS 로그온'
      ELSE '기타'
    END;
  ELSE
    NEW."product_group" := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "items_before_write"
BEFORE INSERT OR UPDATE ON "procurement"."items"
FOR EACH ROW EXECUTE FUNCTION "procurement"."items_before_write"();--> statement-breakpoint
-- 납품요구 한 건((요구번호, 물품))당 한 줄 — 변경차수가 여러 개면 첫 차수(D-9), 삭제 표시(excluded)된 건 제외
CREATE VIEW "procurement"."v_deliveries" WITH (security_invoker = true) AS
SELECT DISTINCT ON ("dlvr_req_no", "item_id")
  "id", "dlvr_req_no", "item_id", "change_ord", "dlvr_req_date", "demand_org", "demand_org_type", "business_name", "contract_no", "contract_type", "vendor", "vendor_type", "vendor_address", "procurement_office", "class_code", "class_name", "item_name", "due_date", "unit_price", "unit", "quantity", "amount", "total_amount", "collected_on", "raw", "created_at", "excluded"
FROM "procurement"."deliveries"
WHERE NOT "excluded"
ORDER BY "dlvr_req_no", "item_id", "change_ord";--> statement-breakpoint
-- 제품별 납품요구 = v_deliveries + 등록 물품(active, 제품 '기타' 제외)
CREATE VIEW "procurement"."v_product_deliveries" WITH (security_invoker = true) AS
SELECT "i"."product", "i"."product_group", "i"."detail_category",
  "d"."id", "d"."dlvr_req_no", "d"."item_id", "d"."change_ord", "d"."dlvr_req_date", "d"."demand_org", "d"."demand_org_type", "d"."business_name", "d"."contract_no", "d"."contract_type", "d"."vendor", "d"."vendor_type", "d"."vendor_address", "d"."procurement_office", "d"."class_code", "d"."class_name", "d"."item_name", "d"."due_date", "d"."unit_price", "d"."unit", "d"."quantity", "d"."amount", "d"."total_amount", "d"."collected_on", "d"."raw", "d"."created_at", "d"."excluded"
FROM "procurement"."v_deliveries" "d"
JOIN "procurement"."items" "i" ON "i"."item_id" = "d"."item_id"
WHERE "i"."status" = 'active' AND "i"."product" <> '기타';--> statement-breakpoint
-- 물품별 계약단가 — 0 초과 단가 중 가장 최근 납품요구일자 기준 (원본과 같게 DESC 기본 = NULL 날짜가 먼저)
CREATE VIEW "procurement"."v_item_prices" WITH (security_invoker = true) AS
SELECT DISTINCT ON ("item_id") "item_id", "unit_price", "dlvr_req_date" AS "price_date"
FROM "procurement"."v_deliveries"
WHERE "unit_price" IS NOT NULL AND "unit_price" > 0
ORDER BY "item_id", "dlvr_req_date" DESC;
