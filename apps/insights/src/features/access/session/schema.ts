import { defineRelationsPart } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

function stamp(name: string) {
	return timestamp(name, { withTimezone: true, mode: "date" });
}

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: stamp("created_at").notNull().defaultNow(),
	updatedAt: stamp("updated_at").notNull().defaultNow(),
	role: text("role"),
	banned: boolean("banned").default(false),
	banReason: text("ban_reason"),
	banExpires: stamp("ban_expires"),
	twoFactorEnabled: boolean("two_factor_enabled").default(false),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: stamp("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: stamp("created_at").notNull().defaultNow(),
		updatedAt: stamp("updated_at").notNull().defaultNow(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		impersonatedBy: text("impersonated_by"),
	},
	(table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: stamp("access_token_expires_at"),
		refreshTokenExpiresAt: stamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: stamp("created_at").notNull().defaultNow(),
		updatedAt: stamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("account_user_id_idx").on(table.userId),
		uniqueIndex("account_provider_account_uidx").on(
			table.providerId,
			table.accountId,
		),
	],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: stamp("expires_at").notNull(),
		createdAt: stamp("created_at").notNull().defaultNow(),
		updatedAt: stamp("updated_at").notNull().defaultNow(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const twoFactor = pgTable(
	"two_factor",
	{
		id: text("id").primaryKey(),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		verified: boolean("verified").default(true),
		failedVerificationCount: integer("failed_verification_count").default(0),
		lockedUntil: stamp("locked_until"),
	},
	(table) => [
		index("two_factor_secret_idx").on(table.secret),
		index("two_factor_user_id_idx").on(table.userId),
	],
);

export const authRelations = defineRelationsPart(
	{ user, session, account, verification, twoFactor },
	(relate) => ({
		user: {
			sessions: relate.many.session({
				from: relate.user.id,
				to: relate.session.userId,
			}),
			accounts: relate.many.account({
				from: relate.user.id,
				to: relate.account.userId,
			}),
			twoFactors: relate.many.twoFactor({
				from: relate.user.id,
				to: relate.twoFactor.userId,
			}),
		},
		session: {
			user: relate.one.user({
				from: relate.session.userId,
				to: relate.user.id,
			}),
		},
		account: {
			user: relate.one.user({
				from: relate.account.userId,
				to: relate.user.id,
			}),
		},
		twoFactor: {
			user: relate.one.user({
				from: relate.twoFactor.userId,
				to: relate.user.id,
			}),
		},
	}),
);
