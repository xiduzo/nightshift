import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { createdAt, spaceId } from "./columns";
import { device } from "./devices";

// Owner: `@nightshift/engine`, `projects/`: the Projects of a Space and
// their Clones.

/**
 * A repository that runs can start in, by its remote. Its folders are its
 * Clones, one per Device at most.
 */
export const project = sqliteTable(
	"project",
	{
		id: text("id").primaryKey(),
		/** The one Space the project is in. Its Clones, runs and events are in it too. */
		spaceId: spaceId(),
		name: text("name").notNull(),
		/**
		 * The `origin` URL, normalised (`github.com/owner/repo`), so the ssh
		 * and https URLs of one repository are one Project. Null for a
		 * repository without a remote: that Project has one Clone, for good.
		 */
		remote: text("remote"),
		createdAt: createdAt(),
		/** Set when a person removed the project. Its runs and events stay. Adding its folder again clears it. */
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		uniqueIndex("project_remote_idx").on(table.remote),
		index("project_spaceId_idx").on(table.spaceId),
	],
);

/** A Project's repository on one Device, at a path. Owned by that Device. */
export const clone = sqliteTable(
	"clone",
	{
		id: text("id").primaryKey(),
		spaceId: spaceId(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id),
		/** Absolute path of the folder on that Device. Known to its owner only. */
		path: text("path").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("clone_deviceId_path_idx").on(table.deviceId, table.path),
		uniqueIndex("clone_projectId_deviceId_idx").on(
			table.projectId,
			table.deviceId,
		),
	],
);
