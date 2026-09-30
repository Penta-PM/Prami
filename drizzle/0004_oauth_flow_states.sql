CREATE TABLE "oauth_flow_states" (
	"user_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"vendor" text NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_flow_states_user_id_state_hash_pk" PRIMARY KEY("user_id","state_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_flow_states" ADD CONSTRAINT "oauth_flow_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_flow_states_expires_at_idx" ON "oauth_flow_states" USING btree ("expires_at");