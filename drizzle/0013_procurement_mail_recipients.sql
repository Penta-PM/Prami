CREATE TABLE "procurement"."mail_recipients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_recipients_email_lower_key" ON "procurement"."mail_recipients" USING btree (lower("email"));