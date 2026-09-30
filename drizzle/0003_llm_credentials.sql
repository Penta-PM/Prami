CREATE TYPE "public"."llm_auth_type" AS ENUM('api_key', 'oauth_pkce');--> statement-breakpoint
CREATE TYPE "public"."llm_credential_status" AS ENUM('unverified', 'valid', 'invalid', 'forbidden', 'rate_limited', 'error');--> statement-breakpoint
CREATE TABLE "user_llm_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"auth_type" "llm_auth_type" NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"secret_tag" "bytea" NOT NULL,
	"dek_wrapped" "bytea" NOT NULL,
	"dek_iv" "bytea" NOT NULL,
	"dek_tag" "bytea" NOT NULL,
	"kek_version" integer NOT NULL,
	"key_hint" text NOT NULL,
	"status" "llm_credential_status" DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error_code" text,
	"last_used_at" timestamp with time zone,
	"available_models" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "user_llm_credentials_user_vendor_uq" UNIQUE("user_id","vendor"),
	CONSTRAINT "user_llm_credentials_vendor_ck" CHECK ("user_llm_credentials"."vendor" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "user_llm_credentials_secret_iv_ck" CHECK (octet_length("user_llm_credentials"."secret_iv") = 12),
	CONSTRAINT "user_llm_credentials_secret_tag_ck" CHECK (octet_length("user_llm_credentials"."secret_tag") = 16),
	CONSTRAINT "user_llm_credentials_dek_wrapped_ck" CHECK (octet_length("user_llm_credentials"."dek_wrapped") = 32),
	CONSTRAINT "user_llm_credentials_dek_iv_ck" CHECK (octet_length("user_llm_credentials"."dek_iv") = 12),
	CONSTRAINT "user_llm_credentials_dek_tag_ck" CHECK (octet_length("user_llm_credentials"."dek_tag") = 16),
	CONSTRAINT "user_llm_credentials_kek_version_ck" CHECK ("user_llm_credentials"."kek_version" >= 1),
	CONSTRAINT "user_llm_credentials_key_hint_ck" CHECK ("user_llm_credentials"."key_hint" ~ '^[A-Za-z-]{0,8}…[A-Za-z0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_default_vendor" text,
	"chat_default_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_llm_credentials" ADD CONSTRAINT "user_llm_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_llm_credentials_kek_version_idx" ON "user_llm_credentials" USING btree ("kek_version");