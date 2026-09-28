DROP INDEX "material_costs_series_effective_uq";--> statement-breakpoint
CREATE INDEX "material_costs_series_effective_idx" ON "material_costs" USING btree ("series_key","effective_from");