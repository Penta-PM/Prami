-- r4 §4.3.4 (Main 결정 B): 원가 원본에 같은 계열·같은 적용시작일 행이 있어 material_costs 만 UNIQUE 를 제거하고
-- 원본 행 번호(source_row)를 tie-break 근거로 둔다. sales_prices 의 부분 UNIQUE 는 그대로.
DROP INDEX IF EXISTS "material_costs_series_effective_uq";--> statement-breakpoint
ALTER TABLE "material_costs" ADD COLUMN IF NOT EXISTS "source_row" integer;--> statement-breakpoint
DROP INDEX IF EXISTS "material_costs_series_effective_idx";--> statement-breakpoint
CREATE INDEX "material_costs_series_effective_idx" ON "material_costs" USING btree ("series_key","effective_from","source_row");
