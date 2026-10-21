CREATE TABLE "user_view_states" (
	"user_id" uuid NOT NULL,
	"page_key" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"scroll" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_view_states_user_id_page_key_pk" PRIMARY KEY("user_id","page_key")
);
--> statement-breakpoint
ALTER TABLE "user_view_states" ADD CONSTRAINT "user_view_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;