import { sql } from "drizzle-orm";
import {
	bigserial,
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/**
 * One accepted usage event. `country` comes from the caller
 * (CF-IPCountry). This table has no IP column.
 *
 * The typed columns are the fields every event shares. `attributes`
 * holds the rest, already checked against the usage-event schema.
 */
export const usageEvent = pgTable(
	"usage_event",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		eventName: text("event_name").notNull(),
		installId: text("install_id"),
		eventTime: timestamp("event_time", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		serviceVersion: text("service_version"),
		osType: text("os_type"),
		hostArch: text("host_arch"),
		country: text("country"),
		attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull(),
	},
	(table) => [
		index("usage_event_install_time").on(table.installId, table.eventTime),
		index("usage_event_name_time").on(table.eventName, table.eventTime),
		check(
			"usage_event_country",
			sql`${table.country} IS NULL OR ${table.country} ~ '^[A-Z0-9]{2}$'`,
		),
	],
);
