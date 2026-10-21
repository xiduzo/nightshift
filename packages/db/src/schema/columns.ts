import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

// The columns that many tables share.

/**
 * The Space a row belongs to (the tenant id): an organization's id. No
 * foreign key: a Space's rows may reach a Replica before the Space does.
 * Every query of a person reads one Space.
 */
export const spaceId = () => text("space_id").notNull();

export const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

export const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();
