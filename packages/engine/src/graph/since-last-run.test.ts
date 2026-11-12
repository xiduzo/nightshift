import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { nodeMemory } from "@nightshift/db/schema";
import type { Flow, JsonValue, SinceLastRunNode } from "@nightshift/flows";
import { forgetMemory, listMemory } from "../memory";
import { drive, flowOf, payloads, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * The Since last run node on the compiled graph: what it remembers between
 * runs of a saved flow (`node_memory`), what it saves with each step
 * (`StepEnded.memory`, only what is new or changed), how it compares a
 * list and a value, and where its memory is split: by scope, by Subflow
 * node, and not at all in a quick run.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

type SinceNode = Omit<SinceLastRunNode, "id" | "type" | "position">;

const at = { x: 0, y: 0 };

/** One Since last run node over the input `items` (or `value`). */
function watching(extra: Partial<SinceNode> = {}): Flow {
	return flowOf(
		[
			{
				id: "fresh",
				type: "since-last-run",
				position: at,
				items: "{{items}}",
				key: "id",
				compare: ["title"],
				...extra,
			},
		],
		[],
		{
			inputs: [
				{ name: "items", type: "json" },
				{ name: "value", type: "json" },
				{ name: "feed", type: "text", default: "main" },
			],
		},
	);
}

/** Runs `flow` once with these inputs; returns its step's outcome, data and memory. */
async function runOnce(
	flow: Flow,
	inputs: Record<string, JsonValue>,
	options: { flowName?: string | null; flows?: Record<string, Flow> } = {},
) {
	const flowName =
		options.flowName === undefined ? "feeds" : (options.flowName ?? undefined);
	const h = await startRun(sandbox, flow, {
		...(flowName === undefined ? {} : { flowName }),
		...(options.flows ? { flows: options.flows } : {}),
		inputs,
	});
	const driven = await drive(h, { inputs });
	expect(driven.parked).toEqual([]);
	const ended = payloads(await h.events(), "StepEnded");
	return { state: driven.state, ended, last: ended.at(-1) };
}

const memory = (flowName = "feeds") =>
	listMemory(sandbox.db, {
		spaceId: sandbox.spaceId,
		projectId: "project-1",
		flowName,
	});

describe("the Since last run node", () => {
	test("the first run finds every item new; a later run finds what is new and what changed, and saves only that", async () => {
		const flow = watching();
		const first = await runOnce(flow, {
			items: [
				{ id: 1, title: "a" },
				{ id: 2, title: "b" },
			],
		});
		expect(first.last?.outcome).toBe("new");
		expect(first.last?.outputs.data).toEqual({
			new: [
				{ id: 1, title: "a" },
				{ id: 2, title: "b" },
			],
			changed: [],
			same_count: 0,
			first_run: true,
		});
		expect(first.state.ended?.nodeId).toBe("fresh");

		const second = await runOnce(flow, {
			items: [
				{ id: 1, title: "a", seen: 3 },
				{ id: 2, title: "B" },
				{ id: 3, title: "c" },
			],
		});
		expect(second.last?.outcome).toBe("new");
		expect(second.last?.outputs.data).toEqual({
			new: [{ id: 3, title: "c" }],
			changed: [{ id: 2, title: "B" }],
			same_count: 1,
			first_run: false,
		});
		// Only what is new or changed goes on the event.
		expect(Object.keys(second.last?.memory?.items ?? {})).toEqual(["2", "3"]);
		expect(second.last?.memory).toMatchObject({
			rootFlow: "feeds",
			nodePath: "fresh",
			scope: "",
		});

		const third = await runOnce(flow, {
			items: [
				{ id: 2, title: "B" },
				{ id: 3, title: "c" },
			],
		});
		expect(third.last?.outcome).toBe("same");
		expect(third.last?.outputs.data).toMatchObject({ same_count: 2 });
		expect(third.last?.memory).toBeUndefined();

		const changedOnly = await runOnce(flow, {
			items: [{ id: 3, title: "C" }],
		});
		expect(changedOnly.last?.outcome).toBe("changed");

		expect(await memory()).toMatchObject([
			{ node: "fresh", scope: "", keys: 3 },
		]);
	});

	test("with firstRun same, the first run finds nothing new but remembers it all", async () => {
		const flow = watching({
			firstRun: "same",
			key: undefined,
			compare: undefined,
		});
		const first = await runOnce(flow, { items: ["a", "b"] });
		expect(first.last?.outcome).toBe("same");
		expect(first.last?.outputs.data).toEqual({
			new: [],
			changed: [],
			same_count: 2,
			first_run: true,
		});
		const second = await runOnce(flow, { items: ["a", "b", "c", "c"] });
		expect(second.last?.outcome).toBe("new");
		// A key that comes twice counts once.
		expect(second.last?.outputs.data).toMatchObject({
			new: ["c"],
			same_count: 2,
		});
	});

	test("a value with a rule over previous and current is a threshold", async () => {
		const flow = watching({
			items: undefined,
			key: undefined,
			compare: undefined,
			value: "{{value}}",
			when: "current > 100 and previous <= 100",
			firstRun: "same",
		});
		const outcomes: (string | undefined)[] = [];
		for (const value of [90, 120, 130, 80, 101]) {
			outcomes.push((await runOnce(flow, { value })).last?.outcome);
		}
		expect(outcomes).toEqual(["same", "changed", "same", "same", "changed"]);
		const again = await runOnce(flow, { value: 101 });
		expect(again.last?.outcome).toBe("same");
		expect(again.last?.outputs.data).toMatchObject({
			previous: 101,
			current: 101,
			first_run: false,
		});
		// An unchanged value saves nothing.
		expect(again.last?.memory).toBeUndefined();
		expect(await memory()).toMatchObject([
			{ node: "fresh", keys: 1, value: 101 },
		]);
	});

	test("a value without a rule changes on any change", async () => {
		const flow = watching({
			items: undefined,
			key: undefined,
			compare: undefined,
			value: "{{value}}",
		});
		const outcomes: (string | undefined)[] = [];
		for (const value of [
			{ a: 1, b: 2 },
			{ b: 2, a: 1 },
			{ a: 2, b: 2 },
		]) {
			outcomes.push((await runOnce(flow, { value })).last?.outcome);
		}
		expect(outcomes).toEqual(["new", "same", "changed"]);
	});

	test("each scope remembers on its own, and Forget makes the next run a first run", async () => {
		const flow = watching({ scope: "{{feed}}" });
		const items = [{ id: 1, title: "a" }];
		await runOnce(flow, { items, feed: "one" });
		const other = await runOnce(flow, { items, feed: "two" });
		expect(other.last?.outcome).toBe("new");
		const again = await runOnce(flow, { items, feed: "one" });
		expect(again.last?.outcome).toBe("same");
		expect((await memory()).map((m) => [m.node, m.scope, m.keys])).toEqual([
			["fresh", "one", 1],
			["fresh", "two", 1],
		]);

		await forgetMemory(
			sandbox.db,
			{ spaceId: sandbox.spaceId, projectId: "project-1", flowName: "feeds" },
			"fresh",
			"one",
		);
		const forgotten = await runOnce(flow, { items, feed: "one" });
		expect(forgotten.last?.outputs.data).toMatchObject({ first_run: true });
		expect((await memory()).map((m) => m.scope)).toEqual(["one", "two"]);
	});

	test("two Subflow nodes that call one flow keep their own memory", async () => {
		const watch = watching();
		const call = (id: string) =>
			({
				id,
				type: "call",
				position: at,
				flow: "watch",
				inputs: { items: "{{items}}" },
			}) as const;
		const caller = flowOf(
			[call("left"), call("right")],
			[{ id: "on", from: "left", outcome: "pass", to: "right" }],
			{ inputs: [{ name: "items", type: "json" }] },
		);
		const items = [{ id: 1, title: "a" }];
		await runOnce(caller, { items }, { flowName: "both", flows: { watch } });
		expect((await memory("both")).map((m) => m.node)).toEqual([
			"left/fresh",
			"right/fresh",
		]);
		const again = await runOnce(
			caller,
			{ items },
			{ flowName: "both", flows: { watch } },
		);
		expect(
			again.ended.filter((e) => e.outputs.data).map((e) => e.outcome),
		).toEqual(["same", "same"]);
	});

	test("Forget on a Subflow node forgets what the nodes inside it saw, and only that", async () => {
		const watch = watching();
		const call = (id: string) =>
			({
				id,
				type: "call",
				position: at,
				flow: "watch",
				inputs: { items: "{{items}}" },
			}) as const;
		// "left_2" starts with "left" but is another node.
		const caller = flowOf(
			[call("left"), call("left_2")],
			[{ id: "on", from: "left", outcome: "pass", to: "left_2" }],
			{ inputs: [{ name: "items", type: "json" }] },
		);
		const items = [{ id: 1, title: "a" }];
		await runOnce(caller, { items }, { flowName: "both", flows: { watch } });
		expect((await memory("both")).map((m) => m.node)).toEqual([
			"left/fresh",
			"left_2/fresh",
		]);
		await forgetMemory(
			sandbox.db,
			{ spaceId: sandbox.spaceId, projectId: "project-1", flowName: "both" },
			"left",
		);
		expect((await memory("both")).map((m) => m.node)).toEqual(["left_2/fresh"]);
		const again = await runOnce(
			caller,
			{ items },
			{ flowName: "both", flows: { watch } },
		);
		expect(
			again.ended.filter((e) => e.outputs.data).map((e) => e.outcome),
		).toEqual(["new", "same"]);
	});

	test("a quick run remembers nothing: each of its runs is a first run", async () => {
		const flow = watching();
		const items = [{ id: 1, title: "a" }];
		for (let i = 0; i < 2; i++) {
			const run = await runOnce(flow, { items }, { flowName: null });
			expect(run.last?.outputs.data).toMatchObject({ first_run: true });
			expect(run.last?.memory).toBeUndefined();
		}
		expect(await sandbox.db.select().from(nodeMemory)).toEqual([]);
	});

	test("a list that is not a list, or an item without its key, ends the step error", async () => {
		const notList = await startRun(sandbox, watching(), {
			flowName: "feeds",
			inputs: { items: "nope" },
		});
		await drive(notList, { inputs: { items: "nope" } });
		const [ended] = payloads(await notList.events(), "StepEnded");
		expect(ended?.outcome).toBe("error");
		expect(ended?.error).toBe(
			'The list of "fresh" is not a list. Check the format of its list: it must give a JSON list, such as {{feed.data.items}}.',
		);

		const items: JsonValue = [{ id: 1 }, { title: "no id" }];
		const noKey = await startRun(sandbox, watching(), {
			flowName: "feeds",
			inputs: { items },
		});
		await drive(noKey, { inputs: { items } });
		const [missing] = payloads(await noKey.events(), "StepEnded");
		expect(missing?.outcome).toBe("error");
		expect(missing?.error).toBe(
			'Item 2 of the list of "fresh" has no id. Check the key of the node, or the list.',
		);
		expect(await sandbox.db.select().from(nodeMemory)).toEqual([]);
	});
});
