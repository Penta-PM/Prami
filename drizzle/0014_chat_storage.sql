CREATE TYPE "public"."chat_domain" AS ENUM('pricing', 'procurement');--> statement-breakpoint
CREATE TYPE "public"."chat_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" "chat_domain" NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversations_title_len_ck" CHECK ("chat_conversations"."title" is null or char_length("chat_conversations"."title") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "chat_message_role" NOT NULL,
	"content" text NOT NULL,
	"action" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_conversations_user_domain_updated_idx" ON "chat_conversations" USING btree ("user_id","domain","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_created_idx" ON "chat_messages" USING btree ("conversation_id","created_at","id");