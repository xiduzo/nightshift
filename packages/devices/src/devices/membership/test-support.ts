import { randomUUID } from "node:crypto";
import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { device, spaceMerge, spaceSplit } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { HostUnreachableError, NIGHT_SHIFT } from "@nightshift/engine";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { NotPairedError } from "../../links";
import { drizzleMembershipRecord } from "./adapters/out/drizzle-membership-record";
import { fsDatabaseCopy } from "./adapters/out/fs-database-copy";
import { inMemoryHome } from "./adapters/out/in-memory-home";
import { splitBatch } from "./adapters/out/in-memory-neighbours";
import {
	createHomeMembership,
	type HomeMembership,
	type HomeMembershipDeps,
} from "./application/create-home-membership";
import type { Batches } from "./application/ports";
import type { MergeRow, SplitRow } from "./domain/membership-rows";

/**
 * What a suite gives the membership: the database and the engine pieces.
 * The ports are filled here as `wireMembership` fills them. The suites do
 * not use `wireMembership`: it takes no waits (`syncWaitMs`, `pollMs`) and
 * goes on with what stopped by itself.
 */
export type MembershipTestDeps = Omit<
	HomeMembershipDeps,
	| "record"
	| "personalSpaces"
	| "pairedDevices"
	| "databaseCopy"
	| "batches"
	| "wait"
	| "ids"
	| "engineKernel"
	| "isNotPaired"
> & { db: Database };

export function batchesOf(db: Database): Batches {
	return {
		async run(batch) {
			// The adapter that runs an opaque batch reads it back (`RowBatch`).
			const [first, ...rest] = batch as unknown as BatchItem<"sqlite">[];
			if (first) await db.batch([first, ...rest]);
		},
	};
}

/** The membership of this computer over `db`, with the waits of the test. */
export function membershipOver(deps: MembershipTestDeps): HomeMembership {
	const { db, ...rest } = deps;
	const spaces = wireSpaces({ db });
	return createHomeMembership({
		...rest,
		record: drizzleMembershipRecord(db),
		personalSpaces: {
			personalId: (personId) => spaces.personal.findPersonalSpace({ personId }),
			exists: (spaceId) => spaces.hasSpace({ spaceId }),
			adoptBatch: async (input) =>
				(await spaces.personal.adoptPersonalSpace(input)) as never,
			splitBatch: async (input) =>
				(await spaces.personal.splitPersonalSpace(input)) as never,
		},
		pairedDevices: {
			async hasPaired() {
				const [paired] = await db
					.select({ id: device.id })
					.from(device)
					.where(and(eq(device.self, false), isNull(device.revokedAt)))
					.limit(1);
				return paired !== undefined;
			},
		},
		databaseCopy: fsDatabaseCopy(db),
		batches: batchesOf(db),
		wait: {
			sleep: (ms) =>
				new Promise((resolve) => {
					const timer = setTimeout(resolve, ms);
					timer.unref?.();
				}),
		},
		ids: { spaceId: () => randomUUID() },
		engineKernel: {
			nightShift: NIGHT_SHIFT,
			isHostUnreachable: (error) => error instanceof HostUnreachableError,
		},
		isNotPaired: (error) => error instanceof NotPairedError,
	});
}

/** The rows of the record, as a test reads and sets them. */
type HomeRows = {
	/** Runs a batch of the record. */
	runBatch: Batches["run"];
	/** Every merge, in the order they were planned. */
	merges(): Promise<Pick<MergeRow, "fromSpace" | "state">[]>;
	/** Sets the state of every merge, and where its Projects go. */
	setMerges(
		state: MergeRow["state"],
		projectMap: MergeRow["projectMap"],
	): Promise<void>;
	/** Every split, in the order they were planned. */
	splits(): Promise<SplitRow[]>;
};

/**
 * This computer and its home Host in memory (`inMemoryHome`), with the real
 * record over a database in memory. A batch lands as one: its statements in
 * one transaction, then the changes of the others.
 */
export async function home(): Promise<{
	deps: HomeMembershipDeps;
	world: ReturnType<typeof inMemoryHome>["world"] & HomeRows;
}> {
	const db = await migratedDb();
	const batches = batchesOf(db);
	const run: Batches["run"] = async (batch) => {
		const { statements, changes } = splitBatch(batch);
		await batches.run(statements as never);
		for (const change of changes) change();
	};
	const { deps, world } = inMemoryHome(drizzleMembershipRecord(db), run);
	return {
		deps,
		world: Object.assign(world, {
			runBatch: run,
			merges: () =>
				db
					.select({ fromSpace: spaceMerge.fromSpace, state: spaceMerge.state })
					.from(spaceMerge)
					.orderBy(sql`rowid`),
			setMerges: async (
				state: MergeRow["state"],
				projectMap: MergeRow["projectMap"],
			) => {
				await db
					.update(spaceMerge)
					.set({ state, projectMap: JSON.stringify(projectMap) });
			},
			async splits() {
				const rows = await db.select().from(spaceSplit).orderBy(sql`rowid`);
				return rows.map((row) => ({
					...row,
					projects: JSON.parse(row.projects ?? "[]"),
					paused: JSON.parse(row.paused ?? "[]"),
					waiting: JSON.parse(row.waiting ?? "{}"),
				}));
			},
		}),
	};
}
