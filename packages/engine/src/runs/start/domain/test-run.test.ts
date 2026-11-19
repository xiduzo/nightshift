import { describe, expect, test } from "bun:test";
import {
	type AgentNode,
	type DecisionNode,
	FLOW_VERSION,
	type Flow,
	type FlowNode,
	flowSchema,
} from "@nightshift/flows";
import type { TestRunRequest } from "../../../contract";
import {
	checkTestRun,
	PIN_MAX_BYTES,
	PinNotHereError,
	type PinnedOutput,
	type PinSource,
	type PinStep,
	type ResolvedTestRun,
	refuseTestStart,
	resolvePins,
	TEST_RUN_FROM_EDITOR,
	TEST_RUN_MAX_BYTES,
} from "./test-run";

/**
 * A test run's pins and skips before it starts (ADR 27): each pin
 * resolves from this Walker's log to the output it gives, and each mark
 * holds against the flow. Every refusal says what to do. The runs a pin
 * names are states as the run log folds them.
 */

const at = { x: 0, y: 0 };
const PROJECT = { id: "project-1", spaceId: "space-1" };

/** A step of an earlier run: `fetch` gave "fresh" and ended. */
function step(id: string, nodeId: string, fields: Partial<PinStep> = {}) {
	return {
		id,
		nodeId,
		nodeType: "command",
		scope: null,
		endedAt: 10,
		outcome: "pass",
		outputs: { outcome: "pass", log_tail: "fresh", visit: 1 },
		test: null,
		...fields,
	} satisfies PinStep;
}

/** A run of the project with these steps, as this Walker's log has it. */
function runOf(
	steps: PinStep[],
	options: {
		test?: { pinned: Record<string, PinnedOutput> } | null;
		where?: { projectId: string; spaceId: string };
	} = {},
): PinSource {
	return {
		run: options.where ?? { projectId: PROJECT.id, spaceId: PROJECT.spaceId },
		state: {
			test: options.test ?? null,
			steps: new Map(steps.map((s) => [s.id, s])),
		},
	};
}

/** The runs this Walker's log has, by id. */
const logOf =
	(runs: Record<string, PinSource>) =>
	async (runId: string): Promise<PinSource | null> =>
		runs[runId] ?? null;

/** An earlier run that ended: `fetch` gave "fresh", then `note` ran. */
const EARLIER = runOf([step("step-1", "fetch"), step("step-2", "note")]);

const resolve = (
	request: TestRunRequest | undefined,
	runs: Record<string, PinSource> = { "run-earlier": EARLIER },
	where = PROJECT,
) => resolvePins(request, where, logOf(runs));

const pinOf = (stepId: string, runId = "run-earlier") => ({
	pinned: { fetch: { runId, stepId } },
});

describe("refuseTestStart", () => {
	test("lets a person's start of a saved flow pin and skip", () => {
		expect(() =>
			refuseTestStart(
				{ projectId: "p1", flowName: "watch", test: {} },
				{ kind: "manual" },
			),
		).not.toThrow();
	});

	test("refuses a schedule, a webhook and a quick run", () => {
		const marks = { skipped: { check: "pass" } };
		for (const [input, trigger] of [
			[{ flowName: "watch" }, { kind: "schedule" }],
			[{ flowName: "watch" }, { kind: "webhook" }],
			[{ flow: { version: FLOW_VERSION } }, { kind: "manual" }],
		] as const) {
			expect(() =>
				refuseTestStart(
					{ projectId: "p1", test: marks, ...input } as never,
					trigger,
				),
			).toThrow(TEST_RUN_FROM_EDITOR);
		}
	});
});

describe("resolvePins", () => {
	test("resolves a pin to the output of the step it names, and keeps the skips", async () => {
		const resolved = await resolve({
			pinned: { fetch: { runId: "run-earlier", stepId: "step-1" } },
			skipped: { note: "pass" },
		});
		expect(resolved).toEqual({
			test: {
				pinned: {
					fetch: {
						runId: "run-earlier",
						stepId: "step-1",
						endedAt: 10,
						outcome: "pass",
						outputs: { outcome: "pass", log_tail: "fresh", visit: 1 },
					},
				},
				skipped: { note: "pass" },
			},
			types: { fetch: "command" },
		});
	});

	test("a start with no pins and no skips is no test run", async () => {
		expect(await resolve({})).toBeNull();
		expect(await resolve({ pinned: {}, skipped: {} })).toBeNull();
		expect(await resolve(undefined)).toBeNull();
	});

	test("refuses a node that is both pinned and skipped", async () => {
		await expect(
			resolve({ ...pinOf("step-1"), skipped: { fetch: "pass" } }),
		).rejects.toThrow('You pinned and skipped "fetch". Choose one of the two.');
	});

	test("refuses a run or a step it cannot find, also a run of another project or Space", async () => {
		const lost =
			'Night Shift cannot find the output you pinned on "fetch". Pin a newer output.';
		await expect(resolve(pinOf("step-1", "run-gone"))).rejects.toThrow(lost);
		await expect(resolve(pinOf("gone"))).rejects.toThrow(lost);
		await expect(
			resolve(pinOf("step-1"), undefined, {
				id: "project-2",
				spaceId: PROJECT.spaceId,
			}),
		).rejects.toThrow(lost);
		await expect(
			resolve(pinOf("step-1"), undefined, {
				id: "project-1",
				spaceId: "another-space",
			}),
		).rejects.toThrow(lost);
	});

	test("refuses a step of another node", async () => {
		await expect(resolve(pinOf("step-2"))).rejects.toThrow(
			'The output you pinned on "fetch" is from another node. Pin a newer output.',
		);
	});

	test("refuses a step inside a Subflow", async () => {
		const outer = runOf([
			step("step-1", "work", { scope: { node: "sub", item: null } }),
		]);
		await expect(
			resolve(
				{ pinned: { work: { runId: "run-outer", stepId: "step-1" } } },
				{ "run-outer": outer },
			),
		).rejects.toThrow(
			'The output you pinned on "work" is from a step inside a Subflow. Pin a newer output.',
		);
	});

	test("refuses a step that has not ended", async () => {
		const open = runOf([
			step("step-1", "approve", {
				nodeType: "decision",
				endedAt: null,
				outcome: null,
			}),
		]);
		await expect(
			resolve(
				{ pinned: { approve: { runId: "run-open", stepId: "step-1" } } },
				{ "run-open": open },
			),
		).rejects.toThrow(
			'The step you pinned on "approve" has not ended yet. Pin its output when it ends.',
		);
	});

	test("refuses a step that was skipped: it has no output", async () => {
		const skipped = runOf([step("step-1", "fetch", { test: "skipped" })]);
		await expect(
			resolve(pinOf("step-1", "run-test"), { "run-test": skipped }),
		).rejects.toThrow(
			'"fetch" was skipped in that run, so it has no output. Pin a newer output.',
		);
	});

	test("a pin of a pinned step pins the output it gave, from the step it came from", async () => {
		const first: PinnedOutput = {
			runId: "run-earlier",
			stepId: "step-1",
			endedAt: 10,
			outcome: "pass",
			outputs: { outcome: "pass", log_tail: "fresh", visit: 1 },
		};
		// The test run's step is a stand-in with the earlier output.
		const standIn = runOf(
			[step("step-9", "fetch", { test: "pinned", outcome: "pass" })],
			{ test: { pinned: { fetch: first } } },
		);
		const resolved = await resolve(pinOf("step-9", "run-test"), {
			"run-test": standIn,
		});
		expect(resolved?.test.pinned.fetch).toEqual(first);
		expect(resolved?.types).toEqual({ fetch: "command" });
	});

	test("refuses a pinned output larger than 1 MiB", async () => {
		const big = runOf([
			step("step-1", "fetch", {
				outputs: {
					outcome: "pass",
					log_tail: "x".repeat(PIN_MAX_BYTES),
					visit: 1,
				},
			}),
		]);
		await expect(
			resolve(pinOf("step-1", "run-big"), { "run-big": big }),
		).rejects.toThrow(
			'The output you pinned on "fetch" is larger than 1 MiB. Let the node run instead.',
		);
	});

	test("refuses pinned outputs larger than 4 MiB together: every Replica keeps them", async () => {
		const ids = ["a", "b", "c", "d", "e"];
		// Each fits on its own: 0.9 MiB.
		const near = {
			outcome: "pass",
			log_tail: "x".repeat(Math.floor(PIN_MAX_BYTES * 0.9)),
			visit: 1,
		};
		const many = runOf(
			ids.map((id) => step(`step-${id}`, id, { outputs: near })),
		);
		const pins = (count: number) => ({
			pinned: Object.fromEntries(
				ids
					.slice(0, count)
					.map((id) => [id, { runId: "run-many", stepId: `step-${id}` }]),
			),
		});
		expect(TEST_RUN_MAX_BYTES).toBe(4 * PIN_MAX_BYTES);
		// Four of them hold 3.6 MiB.
		const four = await resolve(pins(4), { "run-many": many });
		expect(Object.keys(four?.test.pinned ?? {})).toEqual(ids.slice(0, 4));
		await expect(resolve(pins(5), { "run-many": many })).rejects.toThrow(
			"These pinned outputs are too large together. Pin fewer nodes or a smaller output.",
		);
	});

	test("a pin this log does not hold names its node: a Host says it has not arrived yet", async () => {
		const lost = await resolve(pinOf("step-1", "run-gone")).catch(
			(error: unknown) => error,
		);
		expect(lost).toBeInstanceOf(PinNotHereError);
		expect(lost).toMatchObject({ kind: "invalid", nodeId: "fetch" });

		const open = runOf([
			step("step-1", "approve", {
				nodeType: "decision",
				endedAt: null,
				outcome: null,
			}),
		]);
		const running = await resolve(
			{ pinned: { approve: { runId: "run-open", stepId: "step-1" } } },
			{ "run-open": open },
		).catch((error: unknown) => error);
		expect(running).toBeInstanceOf(PinNotHereError);
		expect(running).toMatchObject({ kind: "conflict", nodeId: "approve" });
	});

	test("reads the runs it needs, in the order of the pins, and none after a refusal", async () => {
		const asked: string[] = [];
		await expect(
			resolvePins(
				{
					pinned: {
						fetch: { runId: "run-gone", stepId: "step-1" },
						note: { runId: "run-earlier", stepId: "step-2" },
					},
				},
				PROJECT,
				async (runId) => {
					asked.push(runId);
					return runId === "run-earlier" ? EARLIER : null;
				},
			),
		).rejects.toBeInstanceOf(PinNotHereError);
		expect(asked).toEqual(["run-gone"]);
	});
});

describe("checkTestRun", () => {
	const node = (fields: Record<string, unknown>) =>
		({ position: at, ...fields }) as unknown as FlowNode;
	const agent = (id: string, prompt: string): AgentNode => ({
		id,
		type: "agent",
		position: at,
		prompt,
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		session: "fresh",
	});
	const gate = (id: string): DecisionNode => ({
		id,
		type: "decision",
		position: at,
		prompt: "Send it?",
		options: [{ name: "send" }, { name: "hold" }],
		by: "person",
	});
	const flow: Flow = flowSchema.parse({
		version: FLOW_VERSION,
		start: "research",
		nodes: [
			agent("research", "Find leads"),
			gate("approve"),
			{ id: "sub", type: "call", position: at, flow: "inner", inputs: {} },
			node({ id: "joined", type: "join", wait: "all" }),
			node({ id: "finish", type: "end", status: "done" }),
		],
		edges: [],
	});
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
