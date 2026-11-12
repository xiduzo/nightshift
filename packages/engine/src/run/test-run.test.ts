import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DecisionNode, Flow, FlowNode } from "@nightshift/flows";
import { foldRun, type PinnedOutput } from "../log";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	type Harness,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	checkTestRun,
	PIN_MAX_BYTES,
	PinNotHereError,
	type ResolvedTestRun,
	resolveTestRun,
	TEST_RUN_MAX_BYTES,
} from "./test-run";

/**
 * A test run's pins and skips before it starts (ADR 27): each pin
 * resolves from this Walker's log to the output it gives, and each mark
 * holds against the flow. Every refusal says what to do.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const at = { x: 0, y: 0 };
const project = () => ({ id: "project-1", spaceId: sandbox.spaceId });

const gate = (id: string): DecisionNode => ({
	id,
	type: "decision",
	position: at,
	prompt: "Send it?",
	options: [{ name: "send" }, { name: "hold" }],
	by: "person",
});

/** The steps of a run by node id: the latest of each. */
async function stepsOf(h: Harness) {
	return new Map(
		[...foldRun(await h.events()).steps.values()].map((s) => [s.nodeId, s]),
	);
}

/** A run that ended: `fetch` gave "fresh", then `note` ran. */
async function earlierRun() {
	const h = await startRun(
		sandbox,
		flowOf(
			[command("fetch", "echo fresh"), command("note", "true")],
			[edge("e1", "fetch", "pass", "note")],
		),
		{ flowName: "watch" },
	);
	await drive(h, { inputs: {} });
	return { h, steps: await stepsOf(h) };
}

const resolve = (
	request: Parameters<typeof resolveTestRun>[0],
	h: Harness,
	where = project(),
) => resolveTestRun(request, where, h.log);

describe("resolveTestRun", () => {
	test("resolves a pin to the output of the step it names, and keeps the skips", async () => {
		const { h, steps } = await earlierRun();
		const fetch = steps.get("fetch");
		const resolved = await resolve(
			{
				pinned: { fetch: { runId: h.runId, stepId: fetch?.id ?? "" } },
				skipped: { note: "pass" },
			},
			h,
		);
		expect(resolved).toEqual({
			test: {
				pinned: {
					fetch: {
						runId: h.runId,
						stepId: fetch?.id ?? "",
						endedAt: fetch?.endedAt ?? 0,
						outcome: "pass",
						outputs: fetch?.outputs ?? {},
					},
				},
				skipped: { note: "pass" },
			},
			types: { fetch: "command" },
		});
		expect(fetch?.outputs.log_tail).toBe("fresh");
	});

	test("a start with no pins and no skips is no test run", async () => {
		const { h } = await earlierRun();
		expect(await resolve({}, h)).toBeNull();
		expect(await resolve({ pinned: {}, skipped: {} }, h)).toBeNull();
		expect(await resolve(undefined, h)).toBeNull();
	});

	test("refuses a node that is both pinned and skipped", async () => {
		const { h, steps } = await earlierRun();
		const ref = { runId: h.runId, stepId: steps.get("fetch")?.id ?? "" };
		await expect(
			resolve({ pinned: { fetch: ref }, skipped: { fetch: "pass" } }, h),
		).rejects.toThrow('You pinned and skipped "fetch". Choose one of the two.');
	});

	test("refuses a run or a step it cannot find, also a run of another project or Space", async () => {
		const { h, steps } = await earlierRun();
		const stepId = steps.get("fetch")?.id ?? "";
		const lost =
			'Night Shift cannot find the output you pinned on "fetch". Pin a newer output.';
		await expect(
			resolve({ pinned: { fetch: { runId: "run-gone", stepId } } }, h),
		).rejects.toThrow(lost);
		await expect(
			resolve({ pinned: { fetch: { runId: h.runId, stepId: "gone" } } }, h),
		).rejects.toThrow(lost);
		const ref = { pinned: { fetch: { runId: h.runId, stepId } } };
		await expect(
			resolve(ref, h, { id: "project-2", spaceId: sandbox.spaceId }),
		).rejects.toThrow(lost);
		await expect(
			resolve(ref, h, { id: "project-1", spaceId: "another-space" }),
		).rejects.toThrow(lost);
	});

	test("refuses a step of another node", async () => {
		const { h, steps } = await earlierRun();
		const stepId = steps.get("note")?.id ?? "";
		await expect(
			resolve({ pinned: { fetch: { runId: h.runId, stepId } } }, h),
		).rejects.toThrow(
			'The output you pinned on "fetch" is from another node. Pin a newer output.',
		);
	});

	test("refuses a step inside a Subflow", async () => {
		const inner = flowOf([command("work", "echo inside")]);
		const h = await startRun(
			sandbox,
			flowOf([
				{ id: "sub", type: "call", position: at, flow: "inner", inputs: {} },
			]),
			{ flows: { inner }, flowName: "outer" },
		);
		await drive(h, { inputs: {} });
		const work = (await stepsOf(h)).get("work");
		expect(work?.scope).not.toBeNull();
		await expect(
			resolve(
				{ pinned: { work: { runId: h.runId, stepId: work?.id ?? "" } } },
				h,
			),
		).rejects.toThrow(
			'The output you pinned on "work" is from a step inside a Subflow. Pin a newer output.',
		);
	});

	test("refuses a step that has not ended", async () => {
		const h = await startRun(sandbox, flowOf([gate("approve")]));
		await drive(h, { inputs: {} });
		const open = (await stepsOf(h)).get("approve");
		expect(open?.endedAt).toBeNull();
		await expect(
			resolve(
				{ pinned: { approve: { runId: h.runId, stepId: open?.id ?? "" } } },
				h,
			),
		).rejects.toThrow(
			'The step you pinned on "approve" has not ended yet. Pin its output when it ends.',
		);
	});

	/** A test run of `fetch` alone, pinned or skipped: its one step. */
	async function standInRun(test: {
		pinned?: Record<string, PinnedOutput>;
		skipped?: Record<string, string>;
	}) {
		const h = await startRun(sandbox, flowOf([command("fetch", "exit 1")]), {
			flowName: "watch",
			test: { pinned: test.pinned ?? {}, skipped: test.skipped ?? {} },
		});
		await drive(h, { inputs: {} });
		const step = (await stepsOf(h)).get("fetch");
		return { h, ref: { runId: h.runId, stepId: step?.id ?? "" } };
	}

	test("refuses a step that was skipped: it has no output", async () => {
		const { h, ref } = await standInRun({ skipped: { fetch: "pass" } });
		await expect(resolve({ pinned: { fetch: ref } }, h)).rejects.toThrow(
			'"fetch" was skipped in that run, so it has no output. Pin a newer output.',
		);
	});

	test("a pin of a pinned step pins the output it gave, from the step it came from", async () => {
		const { h: earlier, steps } = await earlierRun();
		const source = steps.get("fetch");
		const first: PinnedOutput = {
			runId: earlier.runId,
			stepId: source?.id ?? "",
			endedAt: source?.endedAt ?? 0,
			outcome: "pass",
			outputs: source?.outputs ?? {},
		};
		const { h, ref } = await standInRun({ pinned: { fetch: first } });
		// The test run's step is a stand-in with the earlier output.
		expect((await stepsOf(h)).get("fetch")?.test).toBe("pinned");

		const resolved = await resolve({ pinned: { fetch: ref } }, h);
		expect(resolved?.test.pinned.fetch).toEqual(first);
		expect(resolved?.types).toEqual({ fetch: "command" });
	});

	test("refuses a pinned output larger than 1 MiB", async () => {
		const big: PinnedOutput = {
			runId: "run-earlier",
			stepId: "step-earlier",
			endedAt: 1,
			outcome: "pass",
			outputs: {
				outcome: "pass",
				log_tail: "x".repeat(PIN_MAX_BYTES),
				visit: 1,
			},
		};
		const { h, ref } = await standInRun({ pinned: { fetch: big } });
		await expect(resolve({ pinned: { fetch: ref } }, h)).rejects.toThrow(
			'The output you pinned on "fetch" is larger than 1 MiB. Let the node run instead.',
		);
	});

	test("refuses pinned outputs larger than 4 MiB together: every Replica keeps them", async () => {
		const ids = ["a", "b", "c", "d", "e"];
		// Each fits on its own: 0.9 MiB.
		const near: PinnedOutput = {
			runId: "run-earlier",
			stepId: "step-earlier",
			endedAt: 1,
			outcome: "pass",
			outputs: {
				outcome: "pass",
				log_tail: "x".repeat(Math.floor(PIN_MAX_BYTES * 0.9)),
				visit: 1,
			},
		};
		const h = await startRun(
			sandbox,
			flowOf(
				ids.map((id) => command(id, "exit 1")),
				ids.slice(1).map((id, i) => edge(`e${i}`, ids[i] ?? "", "pass", id)),
			),
			{
				flowName: "watch",
				test: {
					pinned: Object.fromEntries(ids.map((id) => [id, near])),
					skipped: {},
				},
			},
		);
		await drive(h, { inputs: {} });
		const steps = await stepsOf(h);
		const pins = (count: number) => ({
			pinned: Object.fromEntries(
				ids
					.slice(0, count)
					.map((id) => [
						id,
						{ runId: h.runId, stepId: steps.get(id)?.id ?? "" },
					]),
			),
		});
		expect(TEST_RUN_MAX_BYTES).toBe(4 * PIN_MAX_BYTES);
		// Four of them hold 3.6 MiB.
		const four = await resolve(pins(4), h);
		expect(Object.keys(four?.test.pinned ?? {})).toEqual(ids.slice(0, 4));
		await expect(resolve(pins(5), h)).rejects.toThrow(
			"These pinned outputs are too large together. Pin fewer nodes or a smaller output.",
		);
	});

	test("a pin this log does not hold names its node: a Host says it has not arrived yet", async () => {
		const { h, steps } = await earlierRun();
		const stepId = steps.get("fetch")?.id ?? "";
		const lost = await resolve(
			{ pinned: { fetch: { runId: "run-gone", stepId } } },
			h,
		).catch((error: unknown) => error);
		expect(lost).toBeInstanceOf(PinNotHereError);
		expect(lost).toMatchObject({ kind: "invalid", nodeId: "fetch" });

		const open = await startRun(sandbox, flowOf([gate("approve")]));
		await drive(open, { inputs: {} });
		const waiting = (await stepsOf(open)).get("approve");
		const running = await resolve(
			{
				pinned: {
					approve: { runId: open.runId, stepId: waiting?.id ?? "" },
				},
			},
			open,
		).catch((error: unknown) => error);
		expect(running).toBeInstanceOf(PinNotHereError);
		expect(running).toMatchObject({ kind: "conflict", nodeId: "approve" });
	});
});

describe("checkTestRun", () => {
	const node = (fields: Record<string, unknown>) =>
		({ position: at, ...fields }) as unknown as FlowNode;
	const flow: Flow = flowOf(
		[
			agent("research", "Find leads"),
			gate("approve"),
			{ id: "sub", type: "call", position: at, flow: "inner", inputs: {} },
			node({ id: "joined", type: "join", wait: "all" }),
			node({ id: "finish", type: "end", status: "done" }),
		],
		[],
	);
	const pin = (outcome: string): PinnedOutput => ({
		runId: "run-earlier",
		stepId: "step-earlier",
		endedAt: 1,
		outcome,
		outputs: { outcome, visit: 1 },
	});
	const check =
		(resolved: Partial<ResolvedTestRun["test"]>, types = {}) =>
		() =>
			checkTestRun(flow, {
				test: { pinned: {}, skipped: {}, ...resolved },
				types,
			});

	test("passes pins and skips that fit the flow", () => {
		expect(
			check(
				{ pinned: { research: pin("pass") }, skipped: { approve: "send" } },
				{ research: "agent" },
			),
		).not.toThrow();
	});

	test("refuses a node the flow does not have", () => {
		expect(check({ pinned: { gone: pin("pass") } }, { gone: "agent" })).toThrow(
			'The flow has no node "gone" now. Unpin its output.',
		);
		expect(check({ skipped: { gone: "pass" } })).toThrow(
			'The flow has no node "gone" now. Stop skipping it.',
		);
	});

	test("refuses an End or a Join: they always run", () => {
		expect(check({ skipped: { finish: "pass" } })).toThrow(
			'"finish" is an End node. A test run always runs it, so you cannot pin or skip it.',
		);
		expect(check({ skipped: { joined: "done" } })).toThrow(
			'"joined" is a Join node. A test run always runs it, so you cannot pin or skip it.',
		);
	});

	test("refuses a skip with an outcome the node does not have, and a Subflow that stops", () => {
		expect(check({ skipped: { approve: "maybe" } })).toThrow(
			'"approve" has no outcome "maybe". Skip it with one of its outcomes.',
		);
		expect(check({ skipped: { sub: "stopped" } })).toThrow(
			'"sub" has no outcome "stopped". Skip it with one of its outcomes.',
		);
	});

	test("refuses a pin of a node that changed its type or its outcomes, or of a step that did not finish", () => {
		expect(
			check({ pinned: { research: pin("pass") } }, { research: "command" }),
		).toThrow(
			'"research" is another type of node than in the run you pinned. Pin a newer output.',
		);
		expect(
			check({ pinned: { research: pin("found") } }, { research: "agent" }),
		).toThrow('"research" has no outcome "found" now. Pin a newer output.');
		expect(
			check({ pinned: { research: pin("error") } }, { research: "agent" }),
		).toThrow(
			'The step you pinned on "research" did not finish. Pin the output of a step that finished.',
		);
	});
});
