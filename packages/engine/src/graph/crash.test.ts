import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { CallEachNode, Flow } from "@nightshift/flows";
import type { LoggedEvent, RunStatus } from "../log";
import { getRunRow } from "../log/run-row";
import {
	deriveOpenGate,
	deriveRunState,
	deriveSteps,
	parseCalledFlows,
	parseRunFlow,
} from "../read";
import {
	agent,
	edge,
	flowOf,
	type Harness,
	startRun,
	testRunner,
} from "../testing/graph";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import { closeOpenWork, openWork } from "./open-work";
import { positionOf } from "./run-position";
import type { Runner } from "./runner";
import type { RunStateValues } from "./state";
import { openThread } from "./thread";

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

/** What a run did, as a person reads it from the log. */
type Story = {
	/** Each step that ended on its own: node, item, outcome. A cut-short step is left out. */
	steps: [string, string | null, string][];
	items: string[];
	ended: { status: string; reason: string | null } | null;
};

/** A step a stop or a daemon death ended: work that a resume takes up again. */
const CUT = new Set(["stopped", "interrupted"]);

function storyOf(events: readonly LoggedEvent[]): Story {
	const steps = deriveSteps(events)
		.filter((s) => s.outcome !== null && !CUT.has(s.outcome))
		.map(
			(s) =>
				[s.nodeId, s.scope?.itemId ?? null, s.outcome as string] as [
					string,
					string | null,
					string,
				],
		);
	const items = events.flatMap((e) =>
		e.type === "ItemStarted"
			? [`started ${e.payload.item.id}`]
			: e.type === "ItemEnded"
				? [`${e.payload.state} ${e.payload.itemId}`]
				: [],
	);
	const ended = events.findLast((e) => e.type === "RunEnded");
	return {
		steps,
		items,
		ended:
			ended?.type === "RunEnded"
				? { status: ended.payload.status, reason: ended.payload.reason }
				: null,
	};
}

/** Where the walk is made to fail: before its `at`-th write, by a crash or a stop. */
type Fault = { at: number; kind: "crash" | "stop" };

/**
 * Opens threads whose writes count, and fail at the fault: a crash throws
 * from that write on (the process is gone); a stop asks the runner to stop
 * the run, then lets the write meet the closed fence.
 */
function faultyThreads(fault: Fault | null) {
	const state = {
		writes: 0,
		/** What each write was, in order: the failure report names the one a fault came before. */
		trace: [] as string[],
		dead: false,
		runner: null as Runner | null,
		runId: "",
		/** True while a person's answer is in its Turn: a stop waits for that Turn, so none comes in between. */
		answering: false,
	};
	async function point(what: string): Promise<void> {
		if (state.dead) throw new Error("the daemon died");
		state.writes += 1;
		state.trace.push(what);
		if (!fault || state.writes !== fault.at) return;
		if (fault.kind === "crash") {
			state.dead = true;
			throw new Error("the daemon died");
		}
		if (!state.answering) {
			await state.runner?.take(state.runId, { kind: "stop" });
		}
	}
	const open: typeof openThread = (row, deps) => {
		const thread = openThread(row, deps);
		const { ctx, saver } = thread;
		const { log } = ctx;
		ctx.log = {
			...log,
			// A row and its event are one batch, counted once.
			append: async (input, writes) => {
				await point(input.type);
				return log.append(input, writes);
			},
		};
		const put = saver.put.bind(saver);
		const putWrites = saver.putWrites.bind(saver);
		const prune = saver.pruneThread.bind(saver);
		saver.put = async (...args) => {
			await point(`checkpoint ${args[0].configurable?.checkpoint_ns ?? ""}`);
			return put(...args);
		};
		saver.putWrites = async (...args) => {
			const channels = args[1].map(([channel]) => channel).join(",");
			await point(
				`writes ${args[0].configurable?.checkpoint_ns ?? ""} ${channels}`,
			);
			return putWrites(...args);
		};
		saver.pruneThread = async (...args) => {
			await point("prune");
			return prune(...args);
		};
		return thread;
	};
	return { state, open };
}

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

const statusOf = async (h: Harness): Promise<RunStatus> =>
	deriveRunState(await h.events()).status;

/** The run once no drive holds it: its status, or "dead" when its daemon died. */
async function settled(
	runner: Runner,
	h: Harness,
	isDead: () => boolean,
): Promise<RunStatus | "dead"> {
	return waitFor(
		async () => {
			if (runner.isActive(h.runId)) return false;
			if (isDead()) return "dead" as const;
			const status = await statusOf(h);
			return status === "running" ? false : status;
		},
		{ label: "the run to settle", timeoutMs: 30_000 },
	);
}

/** A new daemon's startup recovery for the run, then its resume (`run/recovery.ts`). */
async function recover(runner: Runner, h: Harness): Promise<void> {
	const events = await h.events();
	const open = openWork(events, "interrupted");
	if (open.endsRun || open.steps.length > 0 || open.sessions.length > 0) {
		await closeOpenWork(
			{
				db: sandbox.db,
				log: h.log,
				bus: h.deps.bus,
				flowOf: parseRunFlow,
				calledFlowsOf: parseCalledFlows,
			},
			h.runId,
			{
				kind: "interrupted",
				reason: "Night Shift stopped while this run ran.",
			},
		);
	}
	if (open.endsRun) {
		await runner.take(h.runId, { kind: "resume", by: "daemon" });
	} else {
		runner.restore(h.runId, events);
	}
}

/** Walks the flow to its end, with `fault` on the way. Returns the story and the writes the walk made. */
async function walk(
	fault: Fault | null,
	flow: Flow = FLOW,
): Promise<{
	story: Story;
	writes: number;
	trace: string[];
	uncommitted: string[];
}> {
	const h = await startRun(sandbox, flow, {
		harness: harness(),
		flows: { item: ITEM },
	});
	const faulty = faultyThreads(fault);
	const daemon = (open: typeof openThread) =>
		testRunner(h, { openThread: open, overdueSweepMs: 3_600_000 });
	let runner = daemon(faulty.open);
	faulty.state.runner = runner;
	faulty.state.runId = h.runId;
	let restarted = false;
	try {
		await runner.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		});
		for (let turns = 0; ; turns++) {
			if (turns > 20) throw new Error("The run did not end.");
			const status = await settled(
				runner,
				h,
				() => faulty.state.dead && !restarted,
			);
			if (status === "dead") {
				await runner.release();
				runner = daemon(openThread);
				restarted = true;
				await recover(runner, h);
				continue;
			}
			if (status === "finished") break;
			if (status === "waiting") {
				const gate = deriveOpenGate(await h.events());
				if (!gate) throw new Error("No open Gate.");
				faulty.state.answering = true;
				try {
					await runner.take(h.runId, {
						kind: "answer",
						stepId: gate.stepId,
						choice: "yes",
						note: "",
					});
				} finally {
					faulty.state.answering = false;
				}
				continue;
			}
			await runner.take(h.runId, { kind: "resume", by: "person" });
		}
	} finally {
		await runner.release();
	}
	const events = await h.events();
	const values = (await h.thread.graph.getState(h.config))
		.values as RunStateValues;
	const at = positionOf(values, events, null);
	return {
		story: storyOf(events),
		writes: faulty.state.writes,
		trace: faulty.state.trace,
		uncommitted: flow.nodes
			.filter((node) => at.uncommitted(node) !== null)
			.map((node) => node.id),
	};
}

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

describe("a crash at every write of a walk with parallel branches", () => {
	let baseline: Story;
	let writes = 0;

	beforeAll(async () => {
		const clean = await walk(null, FANOUT);
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

	test("the walk without a crash: both branches, the Join, the rule", () => {
		expect(unordered(baseline)).toEqual({
			steps: [
				["build", null, "pass"],
				["decide", null, "go"],
				["joined", null, "done"],
				["lint", null, "pass"],
				["review", null, "pass"],
			],
			items: [],
			ended: {
				status: "finished",
				reason: 'Ended at node "decide" with "go".',
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
					story?: Story;
					uncommitted?: string[];
					error?: string;
				}[] = [];
				for (let at = 1; at <= writes; at++) {
					try {
						const { story, uncommitted } = await walk({ at, kind }, FANOUT);
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
