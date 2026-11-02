import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { createdAt } from "./columns";

// Owner: `@nightshift/telemetry` `usage/`. The anonymous install id, the
// events that still wait on this computer, and the last batch that left.
// Not the Device document and not a Space.

/**
 * One row. The install id and the key that hashes flow and run ids are
 * created together, the first time an event is stored. `activeOn` is the
 * UTC day of the last daily event, so a restart does not store it twice.
 */
export const usageInstall = sqliteTable("usage_install", {
	/** Always 1. */
	id: integer("id").primaryKey(),
	installId: text("install_id").notNull(),
	hmacKey: text("hmac_key").notNull(),
	/** `YYYY-MM-DD` in UTC. Null until the daily event is stored. */
	activeOn: text("active_on"),
	createdAt: createdAt(),
});

/** Anonymous usage events that have not left this computer. */
export const usageOutbox = sqliteTable("usage_outbox", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** The event time, rounded down to the minute, epoch ms. */
	at: integer("at").notNull(),
	/** The anonymous event as JSON. No names, paths or free text. */
	body: text("body").notNull(),
	createdAt: createdAt(),
});

/** The last batch that left, as the anonymous JSON array. One row. */
export const usageSent = sqliteTable("usage_sent", {
	/** Always 1. */
	id: integer("id").primaryKey(),
	body: text("body").notNull(),
	sentAt: integer("sent_at").notNull(),
});
