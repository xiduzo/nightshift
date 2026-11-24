import type { Database } from "@nightshift/db";
import {
	answerCost,
	event,
	organization,
	project,
	run,
} from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import type { RowBatch } from "../contract";
import { drizzleMoveStore } from "./adapters/out/drizzle-move-store";
import { inMemorySpaceMovePorts } from "./adapters/out/in-memory-neighbours";

/** Puts rows on a Replica, and reads them as a test compares them. */
export function moveSeed(db: Database) {
	let seq = 0;
	return {
		async space(id: string) {
			await db
				.insert(organization)
				.values({ id, name: id, slug: id, createdAt: asDate(0) });
		},
		async project(row: {
			id: string;
			spaceId: string;
			remote?: string | null;
		}) {
			await db.insert(project).values({ remote: null, ...row, name: row.id });
		},
		async run(row: {
			id: string;
			spaceId: string;
			projectId: string;
			walkerId: string;
		}) {
			await db.insert(run).values({
				...row,
				flow: "{}",
				title: row.id,
				worktreePath: "",
				branch: "",
				baseRef: "main",
			});
		},
		async event(spaceId: string, runId: string | null) {
			await db.insert(event).values({
				spaceId,
				runId,
				type: "PersonJoined",
				walkerId: "a",
				walkerSeq: ++seq,
			});
		},
		async answerCost(spaceId: string) {
			await db.insert(answerCost).values({
				key: `k${++seq}`,
				spaceId,
				personId: "ada",
				agent: "builder",
				inputTokens: 0,
				outputTokens: 0,
				at: asDate(0),
			});
		},
		runs: () =>
			db.select({ id: run.id, spaceId: run.spaceId }).from(run).orderBy(run.id),
		projects: () =>
			db
				.select({ id: project.id, spaceId: project.spaceId })
				.from(project)
				.orderBy(project.id),
		events: () =>
			db.select({ spaceId: event.spaceId, runId: event.runId }).from(event),
		answerCosts: () =>
			db.select({ spaceId: answerCost.spaceId }).from(answerCost),
		clearRuns: async () => {
			await db.delete(run);
		},
	};
}

/** Every port of the slice: the store over a database, with each call as a step, and the neighbours in memory. */
export async function spaceMovePorts() {
	const db = await migratedDb();
	const ports = inMemorySpaceMovePorts();
	const { steps } = ports;
	const store = drizzleMoveStore(db);
	const committed: unknown[][] = [];
	return {
		...ports,
		rows: { ...moveSeed(db), committed },
		moveStore: {
			...store,
			async runIds(...args: Parameters<typeof store.runIds>) {
				steps.push(`run ids ${args[0]} ${args[1].join(",")}`);
				return store.runIds(...args);
			},
			async projectRows(ids: readonly string[]) {
				steps.push("project rows");
				return store.projectRows(ids);
			},
			async batchOf(move: Parameters<typeof store.batchOf>[0]) {
				steps.push(`batch ${move.to}`);
				return store.batchOf(move);
			},
			/** A row of another package is a marker of a test: it is recorded, and not run. */
			async commit(batches: readonly RowBatch[]) {
				steps.push("commit");
				const all = batches.flatMap((b) => [...(b as unknown as unknown[])]);
				const real = all.filter((i) => typeof i !== "string");
				await store.commit([real as unknown as RowBatch]);
				if (all.length > 0) committed.push(all);
			},
		},
	};
}
