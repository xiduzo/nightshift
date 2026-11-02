import postgres from "postgres";

const STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS "user" (
		"id" text PRIMARY KEY,
		"name" text NOT NULL,
		"email" text NOT NULL UNIQUE,
		"email_verified" boolean NOT NULL DEFAULT false,
		"image" text,
		"created_at" timestamptz NOT NULL DEFAULT now(),
		"updated_at" timestamptz NOT NULL DEFAULT now(),
		"role" text,
		"banned" boolean DEFAULT false,
		"ban_reason" text,
		"ban_expires" timestamptz,
		"two_factor_enabled" boolean DEFAULT false
	)`,
	`CREATE TABLE IF NOT EXISTS "session" (
		"id" text PRIMARY KEY,
		"expires_at" timestamptz NOT NULL,
		"token" text NOT NULL UNIQUE,
		"created_at" timestamptz NOT NULL DEFAULT now(),
		"updated_at" timestamptz NOT NULL DEFAULT now(),
		"ip_address" text,
		"user_agent" text,
		"user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
		"impersonated_by" text
	)`,
	`CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" ("user_id")`,
	`CREATE TABLE IF NOT EXISTS "account" (
		"id" text PRIMARY KEY,
		"account_id" text NOT NULL,
		"provider_id" text NOT NULL,
		"user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
		"access_token" text,
		"refresh_token" text,
		"id_token" text,
		"access_token_expires_at" timestamptz,
		"refresh_token_expires_at" timestamptz,
		"scope" text,
		"password" text,
		"created_at" timestamptz NOT NULL DEFAULT now(),
		"updated_at" timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("user_id")`,
	`CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_uidx" ON "account" ("provider_id", "account_id")`,
	`CREATE TABLE IF NOT EXISTS "verification" (
		"id" text PRIMARY KEY,
		"identifier" text NOT NULL,
		"value" text NOT NULL,
		"expires_at" timestamptz NOT NULL,
		"created_at" timestamptz NOT NULL DEFAULT now(),
		"updated_at" timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`,
	`CREATE TABLE IF NOT EXISTS "two_factor" (
		"id" text PRIMARY KEY,
		"secret" text NOT NULL,
		"backup_codes" text NOT NULL,
		"user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
		"verified" boolean DEFAULT true,
		"failed_verification_count" integer DEFAULT 0,
		"locked_until" timestamptz
	)`,
	`CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor" ("secret")`,
	`CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "two_factor" ("user_id")`,
];

/** Creates the Better Auth tables in this app's own database. */
export async function migrateAdminAuth(databaseUrl: string): Promise<void> {
	const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
	try {
		for (const statement of STATEMENTS) await client.unsafe(statement);
	} finally {
		await client.end({ timeout: 5 });
	}
}
