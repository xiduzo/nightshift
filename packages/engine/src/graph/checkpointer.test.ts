import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
	Annotation,
	Command,
	END,
	interrupt,
	START,
	StateGraph,
} from "@langchain/langgraph";
import {
	type CheckpointMetadata,
	emptyCheckpoint,
	uuid6,
} from "@langchain/langgraph-checkpoint";
import { createDb } from "@nightshift/db";

import { createSandbox, type Sandbox } from "../test-support";
import { type LibsqlSaver, saverFor } from "./checkpointer";

let sandbox: Sandbox;
let saver: LibsqlSaver;

beforeEach(async () => {
	sandbox = await createSandbox();
	saver = saverFor(sandbox.db);
});
afterEach(async () => {
	sandbox.db.$client.close();
	await sandbox.cleanup();
});

const thread = (threadId: string, checkpointId?: string) => ({
	configurable: {
		thread_id: threadId,
		checkpoint_ns: "",
		...(checkpointId ? { checkpoint_id: checkpointId } : {}),
	},
});

const metadata = (step: number): CheckpointMetadata => ({
	source: step < 0 ? "input" : "loop",
	step,
	parents: {},
});

/** A checkpoint with a time-ordered id, as LangGraph makes them. */
function checkpoint(values: Record<string, unknown> = {}) {
	const cp = emptyCheckpoint();
	cp.id = uuid6(-3);
	cp.channel_values = { ...values };
	return cp;
}

describe("LibsqlSaver", () => {
	test("put and getTuple round trip, newest checkpoint by default", async () => {
		const first = checkpoint({ count: 1 });
		const second = checkpoint({ count: 2 });
		const firstConfig = await saver.put(
			thread("run-1"),
			first,
			metadata(-1),
			{},
		);
		expect(firstConfig.configurable?.checkpoint_id).toBe(first.id);

		const secondConfig = await saver.put(firstConfig, second, metadata(0), {});

		const newest = await saver.getTuple(thread("run-1"));
		expect(newest?.config).toEqual(secondConfig);
		expect(newest?.checkpoint.id).toBe(second.id);
		expect(newest?.checkpoint.channel_values).toEqual({ count: 2 });
		expect(newest?.metadata).toEqual(metadata(0));
		expect(newest?.parentConfig).toEqual(firstConfig);
		expect(newest?.pendingWrites).toEqual([]);

		const byId = await saver.getTuple(thread("run-1", first.id));
		expect(byId?.checkpoint.channel_values).toEqual({ count: 1 });
		expect(byId?.parentConfig).toBeUndefined();

		expect(await saver.getTuple(thread("other"))).toBeUndefined();
	});

	test("list is newest first, honours limit and before", async () => {
		const a = checkpoint({ i: 0 });
		const b = checkpoint({ i: 1 });
		const c = checkpoint({ i: 2 });
		const d = checkpoint({ i: 3 });
		let config: RunnableConfig = thread("run-1");
		for (const [i, cp] of [a, b, c, d].entries()) {
			config = await saver.put(config, cp, metadata(i - 1), {});
		}
		await saver.put(thread("run-2"), checkpoint(), metadata(-1), {});

		const ids = async (
			options?: Parameters<LibsqlSaver["list"]>[1],
		): Promise<string[]> => {
			const tuples = await Array.fromAsync(
				saver.list(thread("run-1"), options),
			);
			return tuples.map((t) => t.checkpoint.id);
		};
		expect(await ids()).toEqual([d.id, c.id, b.id, a.id]);
		expect(await ids({ limit: 2 })).toEqual([d.id, c.id]);
		expect(await ids({ before: thread("run-1", c.id) })).toEqual([b.id, a.id]);
		expect(await ids({ filter: { step: 1 } })).toEqual([c.id]);
	});

	test("putWrites shows up as the checkpoint's pending writes, in task order", async () => {
		const config = await saver.put(
			thread("run-1"),
			checkpoint(),
			metadata(-1),
			{},
		);
		await saver.putWrites(
			config,
			[
				["count", 2],
				["label", "two"],
			],
			"task-b",
		);
		await saver.putWrites(config, [["count", 1]], "task-a");

		const tuple = await saver.getTuple(config);
		expect(tuple?.pendingWrites).toEqual([
			["task-a", "count", 1],
			["task-b", "count", 2],
			["task-b", "label", "two"],
		]);
	});

	test("pruneThread keeps the latest root checkpoint and its writes, drops the rest of the thread", async () => {
		const body = (threadId: string) => ({
			configurable: { thread_id: threadId, checkpoint_ns: "sub:task-1" },
		});
		const older = await saver.put(
			thread("run-1"),
			checkpoint({ count: 1 }),
			metadata(-1),
			{},
		);
		await saver.putWrites(older, [["count", 1]], "task-a");
		const inBody = await saver.put(
			body("run-1"),
			checkpoint({ count: 9 }),
			metadata(0),
			{},
		);
		await saver.putWrites(inBody, [["count", 9]], "task-b");
		const latest = await saver.put(
			{ ...thread("run-1"), ...older },
			checkpoint({ count: 2 }),
			metadata(1),
			{},
		);
		await saver.putWrites(latest, [["count", 2]], "task-c");
		const other = await saver.put(
			thread("run-2"),
			checkpoint({ count: 5 }),
			metadata(-1),
			{},
		);
		await saver.putWrites(other, [["count", 5]], "task-d");

		await saver.pruneThread("run-1");

		const kept = await saver.getTuple(thread("run-1"));
		expect(kept?.checkpoint.channel_values).toEqual({ count: 2 });
		expect(kept?.pendingWrites).toEqual([["task-c", "count", 2]]);
		expect(await saver.getTuple(body("run-1"))).toBeUndefined();
		const count = async (table: string, threadId: string) =>
			Number(
				(
					await sandbox.db.$client.execute({
						sql: `SELECT count(*) AS n FROM ${table} WHERE thread_id = ?`,
						args: [threadId],
					})
				).rows[0]?.n,
			);
		expect(await count("lg_checkpoint", "run-1")).toBe(1);
		expect(await count("lg_write", "run-1")).toBe(1);
		expect(await count("lg_checkpoint", "run-2")).toBe(1);
		expect(await count("lg_write", "run-2")).toBe(1);
		// Pruning an already pruned thread changes nothing.
		await saver.pruneThread("run-1");
		expect(await count("lg_checkpoint", "run-1")).toBe(1);
	});

	test("deleteThread removes the thread's checkpoints and writes, nothing else", async () => {
		const gone = await saver.put(
			thread("gone"),
			checkpoint(),
			metadata(-1),
			{},
		);
		await saver.putWrites(gone, [["count", 1]], "task");
		const kept = await saver.put(
			thread("kept"),
			checkpoint(),
			metadata(-1),
			{},
		);
		await saver.putWrites(kept, [["count", 1]], "task");

		await saver.deleteThread("gone");

		expect(await saver.getTuple(thread("gone"))).toBeUndefined();
		const { rows } = await sandbox.db.$client.execute(
			"SELECT count(*) AS n FROM lg_write WHERE thread_id = 'gone'",
		);
		expect(Number(rows[0]?.n)).toBe(0);
		expect((await saver.getTuple(thread("kept")))?.pendingWrites).toEqual([
			["task", "count", 1],
		]);
	});
});

describe("a graph on LibsqlSaver", () => {
	const State = Annotation.Root({
		trail: Annotation<string[]>({
			reducer: (a, b) => [...a, ...b],
			default: () => [],
		}),
		answer: Annotation<string | null>({
			reducer: (_, b) => b,
			default: () => null,
		}),
	});

	/** work → ask (interrupts for a person) → finish. */
	const compile = (checkpointer: LibsqlSaver) =>
		new StateGraph(State)
			.addNode("work", () => ({ trail: ["work"] }))
			.addNode("ask", () => {
				const answer = interrupt<string, string>("Ship it?");
				return new Command({ update: { trail: ["ask"], answer }, goto: END });
			})
			.addEdge(START, "work")
			.addEdge("work", "ask")
			.compile({ checkpointer });

	test("checkpoints every super-step in lg_checkpoint", async () => {
		const graph = compile(saver);
		await graph.invoke({}, thread("run-1"));
		const history = await Array.fromAsync(
			graph.getStateHistory(thread("run-1")),
		);
		// input, after work, parked at ask: one checkpoint per super-step.
		expect(history.map((s) => [...s.next])).toEqual([
			["ask"],
			["work"],
			["__start__"],
		]);
		const { rows } = await sandbox.db.$client.execute(
			"SELECT count(*) AS n FROM lg_checkpoint WHERE thread_id = 'run-1'",
		);
		expect(Number(rows[0]?.n)).toBe(3);
	});

	test("an interrupt resumes on a second saver over the same database file", async () => {
		const first = compile(saver);
		const parked = await first.invoke({}, thread("run-1"));
		expect(parked.trail).toEqual(["work"]);
		expect(parked.answer).toBeNull();
		const before = await first.getState(thread("run-1"));
		expect(before.next).toEqual(["ask"]);
		expect(
			before.tasks.flatMap((t) => t.interrupts).map((i) => i.value),
		).toEqual(["Ship it?"]);

		// The daemon restarts: a fresh database handle and a fresh saver, same file.
		const db2 = createDb({ DATABASE_URL: `file:${sandbox.dbPath}` });
		try {
			const second = compile(saverFor(db2));
			const after = await second.getState(thread("run-1"));
			expect(after.next).toEqual(["ask"]);
			expect(after.values.trail).toEqual(["work"]);

			const done = await second.invoke(
				new Command({ resume: "ship" }),
				thread("run-1"),
			);
			expect(done.trail).toEqual(["work", "ask"]);
			expect(done.answer).toBe("ship");
			expect((await second.getState(thread("run-1"))).next).toEqual([]);
		} finally {
			db2.$client.close();
		}
	});
});
