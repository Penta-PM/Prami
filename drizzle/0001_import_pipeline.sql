-- PRAMI-001 PR-3 임포트 파이프라인: 원가·파츠 스테이징, 배치 경고, 적용 실패 사유 (drizzle-kit generate)
CREATE TABLE "stg_material_costs" (
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
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
	CONSTRAINT "stg_material_costs_batch_id_row_index_pk" PRIMARY KEY("batch_id","row_index")
);
--> statement-breakpoint
CREATE TABLE "stg_part_mappings" (
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"model_item_code" text NOT NULL,
	"part_item_code" text NOT NULL,
	"model_name" text,
	"part_name" text,
	CONSTRAINT "stg_part_mappings_batch_id_row_index_pk" PRIMARY KEY("batch_id","row_index")
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_apply_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "stg_material_costs" ADD CONSTRAINT "stg_material_costs_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stg_part_mappings" ADD CONSTRAINT "stg_part_mappings_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;