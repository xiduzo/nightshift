import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { createdAt, spaceId, updatedAt } from "./columns";

// Owner: `@nightshift/devices`: the registry of Devices (`registry/`, also
// this computer's own `device` row, `selfDevice`, and its owner,
// `setSelfOwner`, which the daemon gives `localPerson()`), the links to
// Hosts and their Spaces (`links/`), the exchange of run history and
// commands with them (`exchange/`), and the merge of this computer's own
// personal Space into its home Host's and its split (`membership/`). The engine reads these rows through its
// `DeviceDirectory` port (`deviceDirectory`, in `peers/`).

/**
 * A computer that runs Night Shift. Exactly one row is this computer: the
 * one with `self` set. It is made on the first start (by the migration
 * that added this table, else by `selfDevice`) with a random id that never
 * changes. `self` is this database's own knowledge: a row of another
 * Device that sync brings in never has it.
 */
export const device = sqliteTable(
	"device",
	{
		id: text("id").primaryKey(),
		/** What the person calls it. The host name until they change it. */
		name: text("name").notNull(),
		/** `process.platform`: darwin, linux, win32. */
		platform: text("platform").notNull(),
		/**
		 * On a Host, for a paired Device: the address it joined by when this
		 * Host is its home Host. Null: a guest Host. Not written on the self
		 * row: `host_link` records this computer's own home Host.
		 */
		homeHost: text("home_host"),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
		/**
		 * The Person who owns the Device (a Better Auth user). This
		 * computer's owner is the Person Night Shift signs in for you.
		 */
		ownerId: text("owner_id"),
		/** This computer. At most one row has it. */
		self: integer("self", { mode: "boolean" }).notNull().default(false),
		createdAt: createdAt(),
		/**
		 * On a Host: when its owner removed the Device's access (its key is
		 * gone). Pairing it again clears it.
		 */
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		uniqueIndex("device_self_idx").on(table.self).where(sql`${table.self} = 1`),
	],
);

/**
 * This computer's link to a Host it paired with (`nightshift join`): where
 * the Host answers, which certificate it pinned, and whether the Host is its
 * home or a guest Host. The Device key itself is not here: it is in the
 * keychain, else in a file of the data directory (`key_store`).
 */
export const hostLink = sqliteTable(
	"host_link",
	{
		/** The Host's Device id. */
		hostId: text("host_id").primaryKey(),
		/** The Host's name, as it told this computer. */
		name: text("name").notNull(),
		/** JSON: the Host's addresses, in the order to try them. */
		addresses: text("addresses").notNull(),
		/**
		 * The PEM of the Host's self-signed certificate, pinned at pairing.
		 * Null when the Host's certificate is trusted by this computer, or the
		 * address is a loopback `http://` one.
		 */
		certificate: text("certificate"),
		/** The SHA-256 fingerprint of `certificate`, as shown at pairing. */
		fingerprint: text("fingerprint"),
		/** "home": the Host keeps this Device's document. "guest": shared Spaces only. */
		role: text("role", { enum: ["home", "guest"] }).notNull(),
		/** The Person on the Host whose key this is (who approved the pairing). */
		personId: text("person_id").notNull(),
		/** Where the key is: "keychain" or "file". */
		keyStore: text("key_store", { enum: ["keychain", "file"] }).notNull(),
		createdAt: createdAt(),
		/** When the Host refused the key: its owner removed this computer's access. */
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		uniqueIndex("host_link_home_idx")
			.on(table.role)
			.where(sql`${table.role} = 'home'`),
	],
);

/**
 * A Space this computer takes part in through a Host: the Host keeps it,
 * this Replica keeps a copy (its Space document, its runs). Its owner's
 * role there comes with the Host's answer to the link; the Replica also
 * gets an `organization` row and a `member` row for its own Person with
 * that role, so sessions and permission checks work here unchanged.
 */
export const hostSpace = sqliteTable("host_space", {
	spaceId: text("space_id").primaryKey(),
	/** The Host's Device id. */
	hostId: text("host_id").notNull(),
	name: text("name").notNull(),
	/** The role of this Device's owner in the Space, on the Host. */
	role: text("role").notNull(),
	/** The Space is the personal Space of this Device's owner on the Host. */
	personal: integer("personal", { mode: "boolean" }).notNull().default(false),
	updatedAt: updatedAt(),
});

/**
 * How far this Replica has exchanged run history with one Host, per Space
 * and Walker: the last `walker_seq` it has. For another Walker, the last of
 * its events this Replica pulled from that Host. For this computer, the
 * last of its own events that Host took (a push). A Space starts at 0, so
 * a Space this Device's owner joins later is exchanged from its start.
 */
export const syncCursor = sqliteTable(
	"sync_cursor",
	{
		hostId: text("host_id").notNull(),
		spaceId: text("space_id").notNull(),
		walkerId: text("walker_id").notNull(),
		walkerSeq: integer("walker_seq").notNull(),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({ columns: [table.hostId, table.spaceId, table.walkerId] }),
	],
);

/**
 * A person's action on a run that another Device walks, on its way to the
 * Walker: answer a Gate, send a signal, stop. The Walker is the only writer
 * of its run's events, so the Host keeps the command until the Walker has
 * applied it (`done_at`), with the Walker's reason when it refused.
 */
export const runCommand = sqliteTable(
	"run_command",
	{
		id: text("id").primaryKey(),
		spaceId: spaceId(),
		runId: text("run_id").notNull(),
		/** The Device that walks the run and applies the command. */
		walkerId: text("walker_id").notNull(),
		kind: text("kind", {
			enum: [
				"gate.resolve",
				"signal.send",
				"run.stop",
				"run.move",
				"lease.release",
			],
		}).notNull(),
		/** JSON: the action's input (the Gate's step, choice and note; the signal; when to stop; the lease). */
		payload: text("payload").notNull(),
		/** The Person who asked, on the Host. The Walker checks their role again. */
		personId: text("person_id").notNull(),
		createdAt: createdAt(),
		doneAt: integer("done_at", { mode: "timestamp_ms" }),
		/** Why the Walker did not apply it. Null when it did. */
		error: text("error"),
	},
	(table) => [
		index("run_command_walkerId_idx").on(table.walkerId),
		index("run_command_runId_idx").on(table.runId),
	],
);

/**
 * The merge of this computer's own personal Space into its Person's
 * personal Space on its home Host (ADR 1), one row per merge, so a merge
 * cut short goes on where it stopped. Its states, in order:
 *
 * - `planned`: the copy of the database is made (`backup`). Nothing
 *   else changed.
 * - `mapped`: the Host took the Projects and said where each one goes
 *   (`project_map`, `person_map`).
 * - `moved`: the rows are in the Host's Spaces, in one batch with this
 *   state. The flow documents merge after it.
 * - `pushed`: the Host has the moved runs. The merge is done.
 */
export const spaceMerge = sqliteTable("space_merge", {
	/** This computer's own personal Space, which merges and goes. */
	fromSpace: text("from_space").primaryKey(),
	/** The home Host. */
	hostId: text("host_id").notNull(),
	/** The Person who owns this computer. */
	personId: text("person_id").notNull(),
	state: text("state", {
		enum: ["planned", "mapped", "moved", "pushed"],
	}).notNull(),
	/** The Person's personal Space on the Host, which stays. Null until `mapped`. */
	toSpace: text("to_space"),
	/** JSON: each Project of `from_space` by its id: its Space and id on the Host. */
	projectMap: text("project_map"),
	/** JSON: this computer's Person: their id on the Host. */
	personMap: text("person_map"),
	/** JSON: the Projects the Person chose to move into a shared Space's Project. */
	joined: text("joined").notNull().default("[]"),
	/** The copy of the database made before the merge changed anything. */
	backup: text("backup").notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/**
 * The split of a personal Space off the one this computer's home Host
 * keeps, when this computer leaves that Host (ADR 1: leaving keeps a
 * copy): the Person's own personal Space again, with the Projects this
 * computer has a Clone of and the runs it walked. One row per split, so a
 * split cut short goes on where it stopped. Its states, in order:
 *
 * - `planned`: the copy of the database is made (`backup`). Nothing
 *   else changed.
 * - `moved`: the rows are in the new Space, in one batch with this state.
 * - `done`: the new Space's document has its Projects. The split is done.
 */
export const spaceSplit = sqliteTable("space_split", {
	/** The new personal Space of this computer's own. */
	toSpace: text("to_space").primaryKey(),
	/** The personal Space the home Host keeps, which this computer leaves. */
	fromSpace: text("from_space").notNull(),
	/** The Host this computer leaves. */
	hostId: text("host_id").notNull(),
	/** Its name, for the Space it keeps: "Personal on <Host>". */
	hostName: text("host_name").notNull(),
	/** The Person who owns this computer. */
	personId: text("person_id").notNull(),
	/** The same Person as the Host knows them: the rows that come along name them so. */
	hostPersonId: text("host_person_id").notNull(),
	state: text("state", { enum: ["planned", "moved", "done"] }).notNull(),
	/** JSON: the ids of the Projects that came along. Null until `moved`. */
	projects: text("projects"),
	/** How many runs came along. */
	runs: integer("runs").notNull().default(0),
	/** How many schedules that named another Device are paused on this computer now. */
	unpinned: integer("unpinned").notNull().default(0),
	/** The copy of the database made before the split changed anything. */
	backup: text("backup").notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});
