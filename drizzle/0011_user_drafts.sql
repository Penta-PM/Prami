CREATE TABLE "user_drafts" (
	"user_id" uuid NOT NULL,
	"draft_key" text NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_drafts_user_id_draft_key_pk" PRIMARY KEY("user_id","draft_key")
);
--> statement-breakpoint
ALTER TABLE "user_drafts" ADD CONSTRAINT "user_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;