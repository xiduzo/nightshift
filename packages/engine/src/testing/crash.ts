import type { AgentHarness } from "@nightshift/agents/types";
import type { Flow } from "@nightshift/flows";
import { positionOf } from "../graph/position/run-position";
import { closeOpenWork, openWork } from "../graph/runner/open-work";
import type { Runner } from "../graph/runner/runner";
import { openThread } from "../graph/runner/thread";
import type { RunStateValues } from "../graph/state/state";
import { foldRun, type LoggedEvent } from "../log";
import { getRunRow } from "../log/run-row/run-row";
import { deriveSteps, parseCalledFlows, parseRunFlow } from "../read";
import type { RunStatus } from "../run-status";
import { type Harness, startRun, testRunner } from "./graph";
import { type Sandbox, waitFor } from "./test-support";

/**
 * A walk with a fault before one of its writes (`crash.test.ts` and the
 * sweeps beside it). The writes are every write of a drive: each log
 * append, each row with its event (`StepContext.write`), and each
 * checkpoint write. Before the fault's write the daemon dies (a crash), or
 * a person stops the run (a stop). A new daemon ends the open work as
 * startup recovery does and resumes the run (or the person resumes it),
 * until the run finished.
 */

/** What a run did, as a person reads it from the log. */
export type Story = {
	/** Each step that ended on its own: node, item, outcome. A cut-short step is left out. */
	steps: [string, string | null, string][];
	items: string[];
	ended: { status: string; reason: string | null } | null;
};

/** A step a stop or a daemon death ended: work that a resume takes up again. */
const CUT = new Set(["stopped", "interrupted"]);

export function storyOf(events: readonly LoggedEvent[]): Story {
	const steps = deriveSteps(foldRun(events))
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
export type Fault = { at: number; kind: "crash" | "stop" };

/**
 * Opens threads whose writes count, and fail at the fault: a crash throws
 * from that write on (the process is gone); a stop asks the runner to stop
 * the run, then lets the write meet the closed fence.
 */
export function faultyThreads(fault: Fault | null) {
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
			await state.runner?.take(state.runId, { kind: "stop", by: "person" });
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

const statusOf = async (h: Harness): Promise<RunStatus> =>
	foldRun(await h.events()).status;

/** The run once no drive holds it: its status, or "dead" when its daemon died. */
export async function settled(
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

/** A new daemon's startup recovery for the run, then its resume (`runs/recovery/`). */
export async function recover(runner: Runner, h: Harness): Promise<void> {
	const events = await h.events();
	const open = openWork(foldRun(events), { kind: "interrupted" });
	if (open.endsRun || open.steps.length > 0 || open.sessions.length > 0) {
		await closeOpenWork(
			{
				log: h.log,
				bus: h.deps.shared.bus,
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
		runner.restore(h.runId, foldRun(events));
	}
}

/** What a walk with a fault did. */
export type Walked = {
	story: Story;
	events: LoggedEvent[];
	writes: number;
	trace: string[];
	/** The top-level nodes the checkpoint and the log disagree on (`run-position.ts`). */
	uncommitted: string[];
};

/**
 * Walks `flow` to its end, with `fault` on the way: an open Gate gets
 * "yes", a run that stopped or failed is resumed by a person, a dead
 * daemon is replaced by a new one that recovers the run. The walk ends
 * at a status of `ends` (default: finished).
 */
export async function walkWithFault(
	sandbox: Sandbox,
	fault: Fault | null,
	flow: Flow,
	options: {
		harness: AgentHarness;
		flows?: Record<string, Flow>;
		ends?: readonly RunStatus[];
	},
): Promise<Walked> {
	const { ends = ["finished"], ...start } = options;
	const h = await startRun(sandbox, flow, start);
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
			if (ends.includes(status)) break;
			if (status === "waiting") {
				const gate = foldRun(await h.events()).gate;
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
	const at = positionOf(values, foldRun(events), null);
	return {
		story: storyOf(events),
		events,
		writes: faulty.state.writes,
		trace: faulty.state.trace,
		uncommitted: flow.nodes
			.filter((node) => at.uncommitted(node) !== null)
			.map((node) => node.id),
	};
}
