import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

import { createSandbox, type Sandbox } from "../testing/test-support";
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

/** A body's metadata: the checkpoints of the namespaces above it that it began under. */
const bodyMetadata = (
	step: number,
	parents: Record<string, string>,
): CheckpointMetadata => ({ ...metadata(step), parents });

const body = (threadId: string, ns: string) => ({
	configurable: { thread_id: threadId, checkpoint_ns: ns },
});

/** The thread's rows in `table`, as [namespace, checkpoint id], in order. */
async function rows(
	table: "lg_checkpoint" | "lg_write",
	threadId: string,
): Promise<[string, string][]> {
	const result = await sandbox.db.$client.execute({
		sql: `SELECT checkpoint_ns, checkpoint_id FROM ${table} WHERE thread_id = ? ORDER BY checkpoint_ns, checkpoint_id`,
		args: [threadId],
	});
	return result.rows.map((row) => [
		String(row.checkpoint_ns),
		String(row.checkpoint_id),
	]);
}

/** A checkpoint with a time-ordered id, as LangGraph makes them. */
function checkpoint(values: Record<string, unknown> = {}) {
	const cp = emptyCheckpoint();
	cp.id = uuid6(-3);
	cp.channel_values = { ...values };
	return cp;
}

describe("LibsqlSaver", () => {
	test("put and getTuple round trip; a new checkpoint replaces the older one", async () => {
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

		const byId = await saver.getTuple(thread("run-1", second.id));
		expect(byId?.checkpoint.channel_values).toEqual({ count: 2 });
		expect(await saver.getTuple(thread("run-1", first.id))).toBeUndefined();

		expect(await saver.getTuple(thread("other"))).toBeUndefined();
	});

	test("list is newest first, honours limit and before", async () => {
		// One namespace each: a namespace keeps only its latest checkpoint.
		const all = { configurable: { thread_id: "run-1" } };
		const a = checkpoint({ i: 0 });
		const b = checkpoint({ i: 1 });
		const c = checkpoint({ i: 2 });
		const d = checkpoint({ i: 3 });
		for (const [i, cp] of [a, b, c, d].entries()) {
			await saver.put(
				{ configurable: { thread_id: "run-1", checkpoint_ns: `n${i}` } },
				cp,
				metadata(i - 1),
				{},
			);
		}
		await saver.put(thread("run-2"), checkpoint(), metadata(-1), {});

		const ids = async (
			options?: Parameters<LibsqlSaver["list"]>[1],
		): Promise<string[]> => {
			const tuples = await Array.fromAsync(saver.list(all, options));
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

	test("a new checkpoint drops the older ones of its namespace, and the namespaces below an older one", async () => {
		const first = await saver.put(
			thread("run-1"),
			checkpoint({ count: 1 }),
			metadata(-1),
			{},
		);
		await saver.putWrites(first, [["count", 1]], "task-a");
		const rootId = String(first.configurable?.checkpoint_id);
		const inBody = body("run-1", "call:task-a");
		const older = await saver.put(
			inBody,
			checkpoint({ count: 8 }),
			bodyMetadata(-1, { "": rootId }),
			{},
		);
		await saver.putWrites(older, [["count", 8]], "task-b");
		const newer = await saver.put(
			older,
			checkpoint({ count: 9 }),
			bodyMetadata(0, { "": rootId }),
			{},
		);
		await saver.putWrites(newer, [["count", 9]], "task-c");

		expect(await rows("lg_checkpoint", "run-1")).toEqual([
			["", rootId],
			["call:task-a", String(newer.configurable?.checkpoint_id)],
		]);
		expect((await saver.getTuple(inBody))?.pendingWrites).toEqual([
			["task-c", "count", 9],
		]);

		const second = await saver.put(
			first,
			checkpoint({ count: 2 }),
			metadata(0),
			{},
		);
		expect(await rows("lg_checkpoint", "run-1")).toEqual([
			["", String(second.configurable?.checkpoint_id)],
		]);
		expect(await rows("lg_write", "run-1")).toEqual([]);
	});

	test("pruneThread drops the namespaces of done tasks and the older checkpoints, keeps what a resume reads", async () => {
		const root = await saver.put(
			thread("run-1"),
			checkpoint({ count: 1 }),
			metadata(0),
			{},
		);
		const rootId = String(root.configurable?.checkpoint_id);
		// A database from before: an older root checkpoint and its writes.
		const legacy = checkpoint({ count: 0 });
		await sandbox.db.$client.batch(
			[
				{
					sql: "INSERT INTO lg_checkpoint (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata) VALUES ('run-1', '', ?, 'json', '{}', '{}')",
					args: ["0".repeat(8) + legacy.id.slice(8)],
				},
				{
					sql: "INSERT INTO lg_write (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value) VALUES ('run-1', '', ?, 'old', '', 0, 'count', 'json', '0')",
					args: ["0".repeat(8) + legacy.id.slice(8)],
				},
			],
			"write",
		);
		// Two elements: one done, one parked at a Gate in a body of its own.
		await saver.putWrites(root, [["count", 2]], "done-task");
		await saver.putWrites(root, [["__interrupt__", "Ship it?"]], "open-task");
		const done = await saver.put(
			body("run-1", "each:done-task"),
			checkpoint(),
			bodyMetadata(1, { "": rootId }),
			{},
		);
		const open = await saver.put(
			body("run-1", "each:open-task"),
			checkpoint(),
			bodyMetadata(1, { "": rootId }),
			{},
		);
		const openId = String(open.configurable?.checkpoint_id);
		const inner = await saver.put(
			body("run-1", "each:open-task|gate:inner-task"),
			checkpoint(),
			bodyMetadata(0, { "": rootId, "each:open-task": openId }),
			{},
		);
		await saver.putWrites(inner, [["__interrupt__", "Ship it?"]], "x");
		await saver.put(
			body("run-1", "each:done-task|step:below"),
			checkpoint(),
			bodyMetadata(0, {
				"": rootId,
				"each:done-task": String(done.configurable?.checkpoint_id),
			}),
			{},
		);

		await saver.pruneThread("run-1");

		expect(await rows("lg_checkpoint", "run-1")).toEqual([
			["", rootId],
			["each:open-task", openId],
			[
				"each:open-task|gate:inner-task",
				String(inner.configurable?.checkpoint_id),
			],
		]);
		expect((await saver.getTuple(thread("run-1")))?.pendingWrites).toEqual([
			["done-task", "count", 2],
			["open-task", "__interrupt__", "Ship it?"],
		]);
		const before = await rows("lg_write", "run-1");
		await saver.pruneThread("run-1");
		expect(await rows("lg_write", "run-1")).toEqual(before);
	});

	test("pruneAll prunes every thread that holds more than a resume reads", async () => {
		const legacy = async (threadId: string, ids: string[]) => {
			await sandbox.db.$client.batch(
				ids.map((id) => ({
					sql: "INSERT INTO lg_checkpoint (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata) VALUES (?, '', ?, 'json', '{}', '{}')",
					args: [threadId, id],
				})),
				"write",
			);
		};
		await legacy("old-1", [uuid6(-3), uuid6(-3), uuid6(-3)]);
		await legacy("old-2", [uuid6(-3), uuid6(-3)]);
		await saver.put(thread("clean"), checkpoint(), metadata(-1), {});

		await saver.pruneAll();

		for (const threadId of ["old-1", "old-2", "clean"]) {
			expect(await rows("lg_checkpoint", threadId)).toHaveLength(1);
		}
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

	test("keeps the latest checkpoint of the thread only", async () => {
		const graph = compile(saver);
		await graph.invoke({}, thread("run-1"));
		const history = await Array.fromAsync(
			graph.getStateHistory(thread("run-1")),
		);
		// Parked at ask: the input and the step after work are gone.
		expect(history.map((s) => [...s.next])).toEqual([["ask"]]);
		expect(await rows("lg_checkpoint", "run-1")).toHaveLength(1);
	});

	test("a long loop with a body on each turn keeps a bounded number of checkpoints", async () => {
		const Loop = Annotation.Root({
			turns: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
		});
		const inner = new StateGraph(Loop)
			.addNode("a", (s) => ({ turns: s.turns }))
			.addNode("b", (s) => ({ turns: s.turns + 1 }))
			.addEdge(START, "a")
			.addEdge("a", "b")
			.compile();
		const graph = new StateGraph(Loop)
			.addNode("turn", async (s, config) => inner.invoke(s, config))
			.addEdge(START, "turn")
			.addConditionalEdges("turn", (s) => (s.turns < 40 ? "turn" : END))
			.compile({ checkpointer: saver });
		let most = 0;
		const stream = await graph.stream(
			{},
			{
				...thread("run-1"),
				durability: "sync",
				subgraphs: true,
				recursionLimit: 100,
			},
		);
		for await (const _ of stream) {
			most = Math.max(most, (await rows("lg_checkpoint", "run-1")).length);
		}
		expect((await graph.getState(thread("run-1"))).values.turns).toBe(40);
		// The root, and the body of the turn that runs.
		expect(most).toBeLessThanOrEqual(2);
		expect(await rows("lg_checkpoint", "run-1")).toHaveLength(1);
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
