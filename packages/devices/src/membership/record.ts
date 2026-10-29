import type { Database } from "@nightshift/db";
import { spaceMerge, spaceSplit } from "@nightshift/db/schema";
import { desc, eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { MergeState, SplitState } from "../contract";

/** Where a Project of this computer's own personal Space goes on the Host. */
export type MergeTarget = { spaceId: string; projectId: string };

/** A merge as its row keeps it. */
export type MergeRow = {
	fromSpace: string;
	hostId: string;
	personId: string;
	state: MergeState;
	toSpace: string | null;
	/** Each Project of `fromSpace` by its id: where it goes. */
	projectMap: Record<string, MergeTarget>;
	/** This computer's Person: their id on the Host. */
	personMap: Record<string, string>;
	joined: string[];
	backup: string;
	createdAt: number;
	updatedAt: number;
};

/** A split as its row keeps it. */
export type SplitRow = {
	toSpace: string;
	fromSpace: string;
	hostId: string;
	hostName: string;
	personId: string;
	hostPersonId: string;
	state: SplitState;
	/** The Projects that came along. Empty until `moved`. */
	projects: string[];
	runs: number;
	/** How many schedules that named another Device are paused here now. */
	unpinned: number;
	backup: string;
};

/** The step of the membership that started and is not done. */
export type Unfinished =
	| { step: "merge"; row: MergeRow }
	| { step: "split"; row: SplitRow };

function parse<T>(json: string | null, empty: T): T {
	if (json === null) return empty;
	return JSON.parse(json) as T;
}

function mergeOf(row: typeof spaceMerge.$inferSelect): MergeRow {
	return {
		fromSpace: row.fromSpace,
		hostId: row.hostId,
		personId: row.personId,
		state: row.state,
		toSpace: row.toSpace,
		projectMap: parse(row.projectMap, {}),
		personMap: parse(row.personMap, {}),
		joined: parse(row.joined, []),
		backup: row.backup,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime(),
	};
}

function splitOf(row: typeof spaceSplit.$inferSelect): SplitRow {
	return {
		toSpace: row.toSpace,
		fromSpace: row.fromSpace,
		hostId: row.hostId,
		hostName: row.hostName,
		personId: row.personId,
		hostPersonId: row.hostPersonId,
		state: row.state,
		projects: parse(row.projects, []),
		runs: row.runs,
		unpinned: row.unpinned,
		backup: row.backup,
	};
}

/**
 * The record of this computer's membership of its home Host: one row
 * per merge (`space_merge`) and one per split (`space_split`, a sibling:
 * a split has its own states and a new Space as its key). Each step
 * writes its state here, so a crash never leaves one half done, and the
 * step goes on from it.
 */
export function membershipRecord(db: Database) {
	async function unfinishedSplit(): Promise<SplitRow | null> {
		const [row] = await db
			.select()
			.from(spaceSplit)
			.where(ne(spaceSplit.state, "done"))
			.limit(1);
		return row ? splitOf(row) : null;
	}

	async function unfinishedMerge(): Promise<MergeRow | null> {
		const [row] = await db
			.select()
			.from(spaceMerge)
			.where(ne(spaceMerge.state, "pushed"))
			.limit(1);
		return row ? mergeOf(row) : null;
	}

	return {
		/**
		 * The step that started and is not done, if any. A split comes
		 * first: it ends a merge that is not done.
		 */
		async unfinished(): Promise<Unfinished | null> {
			const split = await unfinishedSplit();
			if (split) return { step: "split", row: split };
			const merge = await unfinishedMerge();
			return merge ? { step: "merge", row: merge } : null;
		},

		merges: {
			/** The latest merge, done or not. */
			async latest(): Promise<MergeRow | null> {
				const rows = await db.select().from(spaceMerge);
				const latest = rows.sort(
					(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
				)[0];
				return latest ? mergeOf(latest) : null;
			},

			/** A new merge, planned: its copy of the database is made. */
			async plan(input: {
				fromSpace: string;
				hostId: string;
				personId: string;
				joined: readonly string[];
				backup: string;
			}): Promise<MergeRow> {
				const [row] = await db
					.insert(spaceMerge)
					.values({
						fromSpace: input.fromSpace,
						hostId: input.hostId,
						personId: input.personId,
						state: "planned",
						joined: JSON.stringify(input.joined),
						backup: input.backup,
					})
					.returning();
				if (!row) throw new Error("The merge was not recorded.");
				return mergeOf(row);
			},

			/** The Host took the Projects: where each one goes. */
			async mapped(
				fromSpace: string,
				input: {
					toSpace: string;
					projectMap: Record<string, MergeTarget>;
					personMap: Record<string, string>;
				},
			): Promise<void> {
				await db
					.update(spaceMerge)
					.set({
						state: "mapped",
						toSpace: input.toSpace,
						projectMap: JSON.stringify(input.projectMap),
						personMap: JSON.stringify(input.personMap),
						updatedAt: new Date(),
					})
					.where(eq(spaceMerge.fromSpace, fromSpace));
			},

			/** The statement that marks the merge moved: it goes in the batch that moves the rows. */
			moved(fromSpace: string): BatchItem<"sqlite"> {
				return db
					.update(spaceMerge)
					.set({ state: "moved", updatedAt: new Date() })
					.where(eq(spaceMerge.fromSpace, fromSpace));
			},

			/**
			 * The statement that ends a merge that is not done, when this
			 * computer leaves its home Host: it can no longer go on.
			 */
			abandon(): BatchItem<"sqlite"> {
				return db.delete(spaceMerge).where(ne(spaceMerge.state, "pushed"));
			},

			/** The Host has the moved runs. */
			async pushed(fromSpace: string): Promise<void> {
				await db
					.update(spaceMerge)
					.set({ state: "pushed", updatedAt: new Date() })
					.where(eq(spaceMerge.fromSpace, fromSpace));
			},
		},

		splits: {
			/** The latest split of that Space, done or not. */
			async of(fromSpace: string): Promise<SplitRow | null> {
				const [row] = await db
					.select()
					.from(spaceSplit)
					.where(eq(spaceSplit.fromSpace, fromSpace))
					.orderBy(desc(spaceSplit.createdAt))
					.limit(1);
				return row ? splitOf(row) : null;
			},

			/** A new split, planned: its copy of the database is made. */
			async plan(
				input: Omit<SplitRow, "state" | "projects" | "runs" | "unpinned">,
			): Promise<SplitRow> {
				const [row] = await db
					.insert(spaceSplit)
					.values({ ...input, state: "planned" })
					.returning();
				if (!row) throw new Error("The split was not recorded.");
				return splitOf(row);
			},

			/** The statement that marks the split moved: it goes in the batch that moves the rows. */
			moved(
				toSpace: string,
				input: {
					projects: readonly string[];
					runs: number;
					unpinned: number;
				},
			): BatchItem<"sqlite"> {
				return db
					.update(spaceSplit)
					.set({
						state: "moved",
						projects: JSON.stringify(input.projects),
						runs: input.runs,
						unpinned: input.unpinned,
						updatedAt: new Date(),
					})
					.where(eq(spaceSplit.toSpace, toSpace));
			},

			/** The new Space's document has its Projects. */
			async done(toSpace: string): Promise<void> {
				await db
					.update(spaceSplit)
					.set({ state: "done", updatedAt: new Date() })
					.where(eq(spaceSplit.toSpace, toSpace));
			},
		},
	};
}

export type MembershipRecord = ReturnType<typeof membershipRecord>;
