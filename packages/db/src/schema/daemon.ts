import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Owner: `@nightshift/daemon`, `runtime/`: the single-writer lease
// (`lease.ts`), and the health check that reads it (`health.ts`). Another
// process reads it through `@nightshift/daemon/heartbeat`.

/**
 * The single-writer lease: one row, held by the one daemon that may write to
 * this database. `epoch` grows by one on every acquisition, so a daemon that
 * lost the lease finds out on its next heartbeat. A null `owner` means
 * released.
 */
export const daemonLease = sqliteTable("daemon_lease", {
	/** Always 1. */
	id: integer("id").primaryKey(),
	/** A random id per daemon process. Null once released. */
	owner: text("owner"),
	host: text("host").notNull(),
	pid: integer("pid").notNull(),
	epoch: integer("epoch").notNull(),
	acquiredAt: integer("acquired_at", { mode: "timestamp_ms" }).notNull(),
	heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" }).notNull(),
});
