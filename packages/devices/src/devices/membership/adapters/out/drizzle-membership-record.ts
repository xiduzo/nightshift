import type { Database } from "@nightshift/db";
import { spaceMerge, spaceSplit } from "@nightshift/db/schema";
import type { RowBatch } from "@nightshift/engine";
import { asDate, instant } from "@nightshift/time";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { MembershipRecord } from "../../application/ports";
import type { MergeRow, SplitRow } from "../../domain/membership-rows";

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
		late: parse(row.late, []),
		backup: row.backup,
		createdAt: instant(row.createdAt),
		updatedAt: instant(row.updatedAt),
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
		paused: parse(row.paused, null),
		backup: row.backup,
	};
}

function asBatch(item: BatchItem<"sqlite">): RowBatch {
	return [item] as unknown as RowBatch;
}

/**
 * The record of this computer's membership of its home Host: one row
 * per merge (`space_merge`) and one per split (`space_split`).
 */
export function drizzleMembershipRecord(db: Database): MembershipRecord {
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
		async unfinished() {
			const split = await unfinishedSplit();
			if (split) return { step: "split", row: split };
			const merge = await unfinishedMerge();
			return merge ? { step: "merge", row: merge } : null;
		},

		merges: {
			async latest() {
				const rows = await db.select().from(spaceMerge);
				const latest = rows.sort(
					(a, b) => instant(b.updatedAt) - instant(a.updatedAt),
				)[0];
				return latest ? mergeOf(latest) : null;
			},

			async done() {
				const rows = await db
					.select()
					.from(spaceMerge)
					.where(eq(spaceMerge.state, "pushed"))
					.orderBy(asc(spaceMerge.createdAt));
				return rows.map(mergeOf);
			},

			async plan(input) {
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

			async mapped(fromSpace, input) {
				await db
					.update(spaceMerge)
					.set({
						state: "mapped",
						toSpace: input.toSpace,
						projectMap: JSON.stringify(input.projectMap),
						personMap: JSON.stringify(input.personMap),
						updatedAt: asDate(),
					})
					.where(eq(spaceMerge.fromSpace, fromSpace));
			},

			moved(fromSpace) {
				return asBatch(
					db
						.update(spaceMerge)
						.set({ state: "moved", updatedAt: asDate() })
						.where(eq(spaceMerge.fromSpace, fromSpace)),
				);
			},

			late(fromSpace, input) {
				return asBatch(
					db
						.update(spaceMerge)
						.set({
							state: "moved",
							projectMap: JSON.stringify(input.projectMap),
							personMap: JSON.stringify(input.personMap),
							late: JSON.stringify(
								Object.values(input.projectMap).map((t) => t.projectId),
							),
							updatedAt: asDate(),
						})
						.where(eq(spaceMerge.fromSpace, fromSpace)),
				);
			},

			abandon() {
				return asBatch(
					db.delete(spaceMerge).where(ne(spaceMerge.state, "pushed")),
				);
			},

			async pushed(fromSpace) {
				await db
					.update(spaceMerge)
					.set({ state: "pushed", updatedAt: asDate() })
					.where(eq(spaceMerge.fromSpace, fromSpace));
			},
		},

		splits: {
			async of(fromSpace) {
				const [row] = await db
					.select()
					.from(spaceSplit)
					.where(eq(spaceSplit.fromSpace, fromSpace))
					.orderBy(desc(spaceSplit.createdAt))
					.limit(1);
				return row ? splitOf(row) : null;
			},

			async plan(input) {
				const [row] = await db
					.insert(spaceSplit)
					.values({ ...input, state: "planned" })
					.returning();
				if (!row) throw new Error("The split was not recorded.");
				return splitOf(row);
			},

			async paused(toSpace, schedules) {
				await db
					.update(spaceSplit)
					.set({ paused: JSON.stringify(schedules), updatedAt: asDate() })
					.where(eq(spaceSplit.toSpace, toSpace));
			},

			async forget(toSpace) {
				await db
					.delete(spaceSplit)
					.where(
						and(
							eq(spaceSplit.toSpace, toSpace),
							eq(spaceSplit.state, "planned"),
						),
					);
			},

			async ofHost(hostId) {
				const rows = await db
					.select()
					.from(spaceSplit)
					.where(
						and(eq(spaceSplit.hostId, hostId), eq(spaceSplit.state, "done")),
					)
					.orderBy(asc(spaceSplit.createdAt));
				return rows.map(splitOf);
			},

			moved(toSpace, input) {
				return asBatch(
					db
						.update(spaceSplit)
						.set({
							state: "moved",
							projects: JSON.stringify(input.projects),
							runs: input.runs,
							unpinned: input.unpinned,
							updatedAt: asDate(),
						})
						.where(eq(spaceSplit.toSpace, toSpace)),
				);
			},

			async done(toSpace) {
				await db
					.update(spaceSplit)
					.set({ state: "done", updatedAt: asDate() })
					.where(eq(spaceSplit.toSpace, toSpace));
			},
		},
	};
}
