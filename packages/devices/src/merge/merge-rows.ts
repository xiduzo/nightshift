import type { Database } from "@nightshift/db";
import { spaceMerge } from "@nightshift/db/schema";
import { eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { MergeState } from "../contract";

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

function parse<T>(json: string | null, empty: T): T {
	if (json === null) return empty;
	return JSON.parse(json) as T;
}

function rowOf(row: typeof spaceMerge.$inferSelect): MergeRow {
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

/** The rows of the merges of this computer (`space_merge`), one per merge. */
export function mergeRows(db: Database) {
	return {
		/** The merge that started and is not done, if any. */
		async unfinished(): Promise<MergeRow | null> {
			const [row] = await db
				.select()
				.from(spaceMerge)
				.where(ne(spaceMerge.state, "pushed"))
				.limit(1);
			return row ? rowOf(row) : null;
		},

		/** The latest merge, done or not. */
		async latest(): Promise<MergeRow | null> {
			const rows = await db.select().from(spaceMerge);
			const latest = rows.sort(
				(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
			)[0];
			return latest ? rowOf(latest) : null;
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
			return rowOf(row);
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

		/** The Host has the moved runs. */
		async pushed(fromSpace: string): Promise<void> {
			await db
				.update(spaceMerge)
				.set({ state: "pushed", updatedAt: new Date() })
				.where(eq(spaceMerge.fromSpace, fromSpace));
		},
	};
}

export type MergeRows = ReturnType<typeof mergeRows>;
