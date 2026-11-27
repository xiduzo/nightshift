import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { CallEachNode, Flow } from "@nightshift/flows";
import { getRunRow } from "../../log/run-row/run-row";
import {
	type Fault,
	faultyThreads,
	recover,
	type Story,
	settled,
	storyOf,
	walkWithFault,
} from "../../testing/crash";
import { agent, edge, flowOf, startRun, testRunner } from "../../testing/graph";
import { createSandbox, type Sandbox } from "../../testing/test-support";

/**
 * A crash at every write. One representative flow runs once to its end.
 * Then it runs again once per write its walk makes, and just before that
 * write the daemon dies, or a person stops the run. A new daemon ends the
 * open work as startup recovery does and resumes the run (or the person
 * resumes it), and the run must end exactly as the run that never crashed:
 * the same steps with the same outcomes, the same items, the same end, and
 * no step done twice. At the end the checkpoint and the log agree: no
 * top-level step is left uncommitted (`run-position.ts`).
 *
 * The writes are every write of a drive: each log append, each row with its
 * event (`StepContext.write`), and each checkpoint write. A crash anywhere
 * else is the same as a crash before the next write. A stop is a Turn, and
 * it waits for the Turn of a person's answer (until the Gate's step ended),
 * so no stop comes before the writes of that stretch. The flow has an Agent,
 * a Decision by a rule, a Call with `each` over two items, and a Gate, so it
 * crosses a harness session, a step with no session, a loop that commits
 * its visit while its step is open, a body in its own namespace, and a step
 * held open across an interrupt. No real harness and no process: the Agent
 * is the fake harness, and the rules are pure.
 */

const ruled = (id: string, option: string) => ({
	id,
	type: "decision" as const,
	position: { x: 0, y: 0 },
	prompt: "",
	options: [{ name: option, when: "true" }],
	by: "rule" as const,
});

const ITEM: Flow = flowOf([ruled("judge", "ok")], [], {
	inputs: [{ name: "item", type: "json", required: true }],
});

const each: CallEachNode = {
	id: "each",
	type: "call",
	position: { x: 0, y: 0 },
	flow: "item",
	inputs: {},
	each: {
		source: {
			kind: "json",
			value: JSON.stringify([
				{ id: "a", title: "a" },
				{ id: "b", title: "b" },
			]),
		},
		as: "item",
		branch: "shared",
		haltOn: ["halt"],
	},
};

const FLOW: Flow = flowOf(
	[
		agent("build", "Build it"),
		ruled("decide", "go"),
		each,
		{
			id: "approve",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "yes" }, { name: "no" }],
			by: "person",
		},
	],
	[
		edge("e1", "build", "pass", "decide"),
		edge("e2", "decide", "go", "each"),
		edge("e3", "each", "done", "approve"),
	],
);

/**
 * The same walk with parallel branches: the agent fans out to a second
 * Agent and a Command, which run side by side and meet at a Join, then a
 * rule decides. Two steps run at once, so a crash comes while both run,
 * between their ends, between the arrivals and the Join, and between the
 * edges of the fan-out.
 */
const FANOUT: Flow = flowOf(
	[
		agent("build", "Build it"),
		agent("review", "Review it"),
		{ id: "lint", type: "command", position: { x: 0, y: 0 }, command: "true" },
		{ id: "joined", type: "join", position: { x: 0, y: 0 }, wait: "all" },
		ruled("decide", "go"),
	],
	[
		edge("f1", "build", "pass", "review"),
		edge("f2", "build", "pass", "lint"),
		edge("f3", "review", "pass", "joined"),
		edge("f4", "lint", "pass", "joined"),
		edge("f5", "joined", "done", "decide"),
	],
);

/**
 * The fan-out again, with the Join as its last node: the crash before
 * `RunEnded` leaves a thread that reached its end and a log without it.
 */
const JOIN_LAST: Flow = flowOf(
	FANOUT.nodes.filter((node) => node.id !== "decide"),
	FANOUT.edges.filter((e) => e.to !== "decide"),
);

let sandbox: Sandbox;
let quiet: ReturnType<typeof spyOn>;
beforeAll(async () => {
	sandbox = await createSandbox();
	// A dying daemon logs what it could not write; that is the point here.
	quiet = spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
	quiet.mockRestore();
	await sandbox.cleanup();
});

const harness = () => fakeHarness({ ...reportingScript("pass"), delayMs: 0 });

/** Walks the flow to its end, with `fault` on the way. */
const walk = (fault: Fault | null, flow: Flow = FLOW) =>
	walkWithFault(sandbox, fault, flow, {
		harness: harness(),
		flows: { item: ITEM },
	});

describe("a crash at every write of a walk", () => {
	let baseline: Story;
	let writes = 0;
	let trace: string[] = [];

	beforeAll(async () => {
		const clean = await walk(null);
		baseline = clean.story;
		writes = clean.writes;
		trace = clean.trace;
	}, 60_000);

	test("the walk without a crash: every node, both items, the Gate's answer", () => {
		expect(baseline).toEqual({
			steps: [
				["build", null, "pass"],
				["decide", null, "go"],
				["each", null, "done"],
				["judge", "a", "ok"],
				["judge", "b", "ok"],
				["approve", null, "yes"],
			],
			items: ["started a", "done a", "started b", "done b"],
			ended: {
				status: "finished",
				reason: 'Ended at node "approve" with "yes".',
			},
		});
		expect(writes).toBeGreaterThan(20);
	});

	for (const kind of ["crash", "stop"] as const) {
		test(
			`a ${kind} before each write: the run ends as the walk without one`,
			async () => {
				const wrong: {
					at: number;
					before: string | undefined;
					story?: Story;
					uncommitted?: string[];
					error?: string;
				}[] = [];
				for (let at = 1; at <= writes; at++) {
					const before = trace[at - 1];
					try {
						const { story, uncommitted } = await walk({ at, kind });
						if (!Bun.deepEquals(story, baseline) || uncommitted.length > 0) {
							wrong.push({ at, before, story, uncommitted });
						}
					} catch (error) {
						wrong.push({ at, before, error: String(error) });
					}
				}
				expect(wrong).toEqual([]);
			},
			{ timeout: 600_000 },
		);
	}
});

test("the daemon dies before the end of a run that failed: the run fails as it would have, and nothing runs again", async () => {
	const flow = flowOf([agent("build", "Build it")]);
	/** The walk to its end, with the daemon dead before write `at`; null: no death. */
	async function failed(at: number | null) {
		const harness = fakeHarness(reportingScript("fail", "No."));
		const h = await startRun(sandbox, flow, { harness });
		const faulty = faultyThreads(at === null ? null : { at, kind: "crash" });
		let runner = testRunner(h, {
			openThread: faulty.open,
			overdueSweepMs: 3_600_000,
		});
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			if ((await settled(runner, h, () => faulty.state.dead)) === "dead") {
				await runner.release();
				runner = testRunner(h, { overdueSweepMs: 3_600_000 });
				await recover(runner, h);
				await settled(runner, h, () => false);
			}
			return {
				trace: faulty.state.trace,
				ended: storyOf(await h.events()).ended,
				calls: harness.calls.length,
			};
		} finally {
			await runner.release();
		}
	}
	const clean = await failed(null);
	expect(clean.ended).toEqual({
		status: "failed",
		reason:
			'Node "build" ended with "fail" and no edge leaves it on that outcome.',
	});
	const before = clean.trace.indexOf("RunEnded") + 1;
	expect(before).toBeGreaterThan(0);
	expect(await failed(before)).toMatchObject({
		ended: clean.ended,
		calls: 1,
	});
});

const PARALLEL = [
	{
		name: "a crash at every write of a walk with parallel branches",
		flow: FANOUT,
		last: [["decide", null, "go"]] as Story["steps"],
		ended: { status: "finished", reason: 'Ended at node "decide" with "go".' },
	},
	{
		name: "a crash at every write of a walk that ends at its Join",
		flow: JOIN_LAST,
		last: [] as Story["steps"],
		ended: { status: "finished", reason: null },
	},
];

for (const shape of PARALLEL) {
	describe(shape.name, () => {
		let baseline: Story;
		let writes = 0;

		beforeAll(async () => {
			const clean = await walk(null, shape.flow);
			baseline = clean.story;
			writes = clean.writes;
		}, 60_000);

		/** The branches end in any order: compare the steps as a set. */
		const unordered = (story: Story) => ({
			...story,
			steps: [...story.steps].sort((a, b) =>
				a.join("|").localeCompare(b.join("|")),
			),
		});

		test("the walk without a crash: both branches, the Join, what comes after", () => {
			expect(unordered(baseline)).toEqual(
				unordered({
					steps: [
						["build", null, "pass"],
						["joined", null, "done"],
						["lint", null, "pass"],
						["review", null, "pass"],
						...shape.last,
					],
					items: [],
					ended: shape.ended,
				}),
			);
			expect(writes).toBeGreaterThan(20);
		});

		for (const kind of ["crash", "stop"] as const) {
			test(
				`a ${kind} before each write: the run ends as the walk without one`,
				async () => {
					const wrong: {
						at: number;
						story?: Story;
						uncommitted?: string[];
						error?: string;
					}[] = [];
					for (let at = 1; at <= writes; at++) {
						try {
							const { story, uncommitted } = await walk(
								{ at, kind },
								shape.flow,
							);
							if (
								!Bun.deepEquals(unordered(story), unordered(baseline)) ||
								uncommitted.length > 0
							) {
								wrong.push({ at, story, uncommitted });
							}
						} catch (error) {
							wrong.push({ at, error: String(error) });
						}
					}
					expect(wrong).toEqual([]);
				},
				{ timeout: 600_000 },
			);
		}
	});
}
