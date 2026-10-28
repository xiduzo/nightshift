import type { Database } from "@nightshift/db";
import { spaceSplit } from "@nightshift/db/schema";
import { desc, eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SplitState } from "../contract";

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

function rowOf(row: typeof spaceSplit.$inferSelect): SplitRow {
	return {
		toSpace: row.toSpace,
		fromSpace: row.fromSpace,
		hostId: row.hostId,
		hostName: row.hostName,
		personId: row.personId,
		hostPersonId: row.hostPersonId,
		state: row.state,
		projects:
			row.projects === null ? [] : (JSON.parse(row.projects) as string[]),
		runs: row.runs,
		unpinned: row.unpinned,
		backup: row.backup,
	};
}

/** The rows of the splits of this computer (`space_split`), one per split. */
export function splitRows(db: Database) {
	return {
		/** The split that started and is not done, if any. */
		async unfinished(): Promise<SplitRow | null> {
			const [row] = await db
				.select()
				.from(spaceSplit)
				.where(ne(spaceSplit.state, "done"))
				.limit(1);
			return row ? rowOf(row) : null;
		},

		/** The latest split of that Space, done or not. */
		async of(fromSpace: string): Promise<SplitRow | null> {
			const [row] = await db
				.select()
				.from(spaceSplit)
				.where(eq(spaceSplit.fromSpace, fromSpace))
				.orderBy(desc(spaceSplit.createdAt))
				.limit(1);
			return row ? rowOf(row) : null;
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
			return rowOf(row);
		},

		/** The statement that marks the split moved: it goes in the batch that moves the rows. */
		moved(
			toSpace: string,
			input: { projects: readonly string[]; runs: number; unpinned: number },
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
	};
}
